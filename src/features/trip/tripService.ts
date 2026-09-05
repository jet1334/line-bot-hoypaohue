import { prisma } from '../../db/prisma.js';
import { TripStatus } from '../../constants.js';
import { computeTripTotals, settle } from './settle.js';
import type { ItemInput } from './settle.js';

export interface CreateTripInput {
  groupId: string;
  ownerId: string;
  title: string;
  note?: string;
}

/** สร้างทริปใหม่ + เพิ่ม owner เป็นสมาชิกคนแรก */
export async function createTrip(input: CreateTripInput) {
  return prisma.trip.create({
    data: {
      groupId: input.groupId,
      ownerId: input.ownerId,
      title: input.title,
      note: input.note,
      status: TripStatus.OPEN,
      members: { create: { userId: input.ownerId } },
    },
    include: { members: true },
  });
}

export function getTripFull(tripId: string) {
  return prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      owner: true,
      group: true,
      members: { include: { user: true }, orderBy: { createdAt: 'asc' } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: { payer: { include: { user: true } }, shares: true },
      },
    },
  });
}

export type TripFull = NonNullable<Awaited<ReturnType<typeof getTripFull>>>;

/** เข้าร่วมทริป (idempotent) คืน { member, created } */
export async function joinTrip(tripId: string, userId: string) {
  const existing = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId } },
  });
  if (existing) return { member: existing, created: false };
  const member = await prisma.tripMember.create({ data: { tripId, userId } });
  return { member, created: true };
}

export interface AddItemInput {
  name: string;
  remark?: string;
  priceSatang: number;
  payerId?: string | null;
  /** memberId ที่ร่วม item นี้ (ค่าเริ่มต้น = ทุกคนในทริป); fixedSatang null = หารเท่า */
  shares?: { memberId: string; fixedSatang?: number | null }[];
}

/**
 * เพิ่ม item เข้าทริป
 * ถ้าไม่ระบุ shares → สร้างให้สมาชิกทุกคนแบบหารเท่า
 */
export async function addItem(tripId: string, input: AddItemInput) {
  const members = await prisma.tripMember.findMany({ where: { tripId }, select: { id: true } });
  if (members.length === 0) throw new Error('ทริปยังไม่มีสมาชิก');

  const memberIds = new Set(members.map((m) => m.id));
  let shares = input.shares;
  if (!shares || shares.length === 0) {
    shares = members.map((m) => ({ memberId: m.id, fixedSatang: null }));
  }
  // validate: memberId ต้องอยู่ในทริป, payer ต้องอยู่ในทริป
  for (const s of shares) {
    if (!memberIds.has(s.memberId)) throw new Error(`memberId ${s.memberId} ไม่ได้อยู่ในทริป`);
  }
  if (input.payerId != null && !memberIds.has(input.payerId)) {
    throw new Error('payer ไม่ได้อยู่ในทริป');
  }

  return prisma.tripItem.create({
    data: {
      tripId,
      name: input.name,
      remark: input.remark,
      priceSatang: input.priceSatang,
      payerId: input.payerId ?? null,
      shares: {
        create: shares.map((s) => ({ memberId: s.memberId, fixedSatang: s.fixedSatang ?? null })),
      },
    },
    include: { shares: true, payer: { include: { user: true } } },
  });
}

export interface UpdateItemInput {
  name?: string;
  remark?: string | null;
  priceSatang?: number;
  payerId?: string | null;
  shares?: { memberId: string; fixedSatang?: number | null }[];
}

/** แก้ไข item; ถ้าส่ง shares มา = แทนที่ทั้งชุด */
export async function updateItem(tripId: string, itemId: string, input: UpdateItemInput) {
  const item = await prisma.tripItem.findFirst({ where: { id: itemId, tripId } });
  if (!item) throw new Error('ไม่พบ item ในทริปนี้');

  const memberIds = new Set(
    (await prisma.tripMember.findMany({ where: { tripId }, select: { id: true } })).map((m) => m.id),
  );
  if (input.payerId != null && !memberIds.has(input.payerId)) {
    throw new Error('payer ไม่ได้อยู่ในทริป');
  }
  if (input.shares) {
    for (const s of input.shares) {
      if (!memberIds.has(s.memberId)) throw new Error(`memberId ${s.memberId} ไม่ได้อยู่ในทริป`);
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.tripItem.update({
      where: { id: itemId },
      data: {
        name: input.name,
        remark: input.remark,
        priceSatang: input.priceSatang,
        ...(input.payerId !== undefined ? { payerId: input.payerId } : {}),
      },
    });
    if (input.shares) {
      await tx.tripItemShare.deleteMany({ where: { itemId } });
      await tx.tripItemShare.createMany({
        data: input.shares.map((s) => ({ itemId, memberId: s.memberId, fixedSatang: s.fixedSatang ?? null })),
      });
    }
    return tx.tripItem.findUnique({
      where: { id: itemId },
      include: { shares: true, payer: { include: { user: true } } },
    });
  });
}

export async function deleteItem(tripId: string, itemId: string) {
  await prisma.tripItem.deleteMany({ where: { id: itemId, tripId } });
}

/** map TripFull.items -> ItemInput สำหรับ settle */
function toItemInputs(trip: TripFull): ItemInput[] {
  return trip.items.map((it) => ({
    priceSatang: it.priceSatang,
    payerId: it.payerId,
    shares: it.shares.map((s) => ({ memberId: s.memberId, fixedSatang: s.fixedSatang })),
  }));
}

/** คำนวณสรุปทริป (owed/paid/net + รายการโอน) โดยไม่เปลี่ยน state */
export async function summarizeTrip(tripId: string) {
  const trip = await getTripFull(tripId);
  if (!trip) throw new Error('trip not found');
  const totals = computeTripTotals(toItemInputs(trip));
  const transfers = settle(totals.net);
  return { trip, totals, transfers };
}

/** ปิดทริป (คำนวณสรุปเพื่อ validate ก่อน แล้วตั้ง status=DONE) */
export async function finalizeTrip(tripId: string) {
  const trip = await getTripFull(tripId);
  if (!trip) throw new Error('trip not found');
  if (trip.status !== TripStatus.OPEN) throw new Error('ทริปนี้ปิดแล้ว');
  if (trip.items.length === 0) throw new Error('ทริปยังไม่มีรายการ');
  // validate: ทุก item ต้องมี payer + share ถูกต้อง (throw ถ้าไม่ครบ)
  computeTripTotals(toItemInputs(trip));
  return prisma.trip.update({ where: { id: tripId }, data: { status: TripStatus.DONE } });
}

export async function cancelTrip(tripId: string) {
  return prisma.trip.update({ where: { id: tripId }, data: { status: TripStatus.CANCELLED } });
}
