import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { upsertUser, upsertGroup, syncGroupMember } from '../features/user.js';
import { createBill, getBillFull, finalizeBill, setCustomAmounts } from '../features/bill/billService.js';
import { joinBill } from '../features/bill/participant.js';
import {
  createTrip,
  getTripFull,
  joinTrip,
  addItem,
  updateItem,
  deleteItem,
  summarizeTrip,
  finalizeTrip,
  type TripFull,
} from '../features/trip/tripService.js';
import { bahtToSatang, satangToBaht } from '../features/bill/split.js';
import { saveBuffer, publicUrl } from '../storage/files.js';
import { pushJoinCard, pushBillCard, notifyIfCycleCompleted, pushTripSummary } from '../line/notify.js';
import { attachSlip, markCash, confirmCharge, rejectCharge, getChargeFull } from '../features/payment/paymentService.js';
import { BillStatus, ChargeStatus, Recurrence, SplitMode, TripStatus } from '../constants.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
export const liffRouter = Router();

/** ตรวจ LIFF access token → คืนโปรไฟล์ผู้ใช้ (userId ที่เชื่อถือได้) */
async function getProfileFromToken(authHeader?: string) {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const res = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as { userId: string; displayName: string; pictureUrl?: string };
}

const createSchema = z.object({
  groupId: z.string().min(1),
  title: z.string().min(1).max(100),
  note: z.string().max(300).optional(),
  splitMode: z.enum([SplitMode.EQUAL, SplitMode.CUSTOM]),
  totalBaht: z.string().optional(), // required เมื่อ EQUAL
  accountName: z.string().max(100).optional(),
  accountNumber: z.string().max(50).optional(),
  bankName: z.string().max(50).optional(),
  recurrence: z.enum([Recurrence.NONE, Recurrence.DAILY, Recurrence.WEEKLY, Recurrence.MONTHLY]),
  interval: z.coerce.number().int().min(1).max(365).default(1),
  repeatCount: z.coerce.number().int().min(1).max(365).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function parseDate(dateStr: string): Date {
  // ตีความเป็นเวลา 09:00 ตามเขตเวลาไทย
  return new Date(`${dateStr}T09:00:00+07:00`);
}

// POST /api/bills — สร้างบิลใหม่ (multipart รองรับไฟล์ QR field ชื่อ "qr")
liffRouter.post('/bills', upload.single('qr'), async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  let totalSatang: number | undefined;
  if (data.splitMode === SplitMode.EQUAL) {
    if (!data.totalBaht) return res.status(400).json({ error: 'totalBaht required for EQUAL' });
    try {
      totalSatang = bahtToSatang(data.totalBaht);
    } catch {
      return res.status(400).json({ error: 'invalid totalBaht' });
    }
    if (totalSatang <= 0) return res.status(400).json({ error: 'totalBaht must be > 0' });
  }

  await upsertUser(profile.userId, profile.displayName, profile.pictureUrl);
  await upsertGroup(data.groupId);

  let qrImagePath: string | undefined;
  if (req.file) {
    qrImagePath = await saveBuffer('qr', req.file.buffer, req.file.mimetype);
  }

  const bill = await createBill({
    groupId: data.groupId,
    ownerId: profile.userId,
    title: data.title,
    note: data.note,
    splitMode: data.splitMode,
    totalSatang,
    accountName: data.accountName,
    accountNumber: data.accountNumber,
    bankName: data.bankName,
    qrImagePath,
    recurrence: data.recurrence,
    interval: data.interval,
    repeatCount: data.repeatCount ?? null,
    startDate: parseDate(data.startDate),
  });

  await pushJoinCard(bill.id);
  res.json({ ok: true, billId: bill.id });
});

// GET /api/bills/:id — รายละเอียดบิล (สำหรับหน้า manage)
liffRouter.get('/bills/:id', async (req, res) => {
  const bill = await getBillFull(req.params.id);
  if (!bill) return res.status(404).json({ error: 'not found' });
  res.json({
    id: bill.id,
    title: bill.title,
    status: bill.status,
    splitMode: bill.splitMode,
    totalBaht: bill.totalSatang != null ? satangToBaht(bill.totalSatang) : null,
    ownerId: bill.ownerId,
    participants: bill.participants.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      pictureUrl: p.user.pictureUrl,
      customBaht: p.customSatang != null ? satangToBaht(p.customSatang) : null,
    })),
  });
});

// GET /api/bills/:id/detail — ดึงรายละเอียดบิลฉบับสมบูรณ์สำหรับแสดงผลบน LIFF
liffRouter.get('/bills/:id/detail', async (req, res) => {
  const bill = await getBillFull(req.params.id);
  if (!bill) return res.status(404).json({ error: 'not found' });

  const profile = await getProfileFromToken(req.headers.authorization);
  const currentUserId = profile?.userId ?? null;

  const currentCycle = bill.cycles[bill.cycles.length - 1] ?? null;

  res.json({
    id: bill.id,
    title: bill.title,
    note: bill.note,
    status: bill.status,
    splitMode: bill.splitMode,
    totalBaht: bill.totalSatang != null ? satangToBaht(bill.totalSatang) : null,
    ownerId: bill.ownerId,
    ownerName: bill.owner.displayName,
    bankName: bill.bankName,
    accountNumber: bill.accountNumber,
    accountName: bill.accountName,
    qrUrl: bill.qrImagePath ? publicUrl(bill.qrImagePath) : null,
    participants: bill.participants.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      pictureUrl: p.user.pictureUrl,
    })),
    currentCycle: currentCycle
      ? {
        id: currentCycle.id,
        cycleNo: currentCycle.cycleNo,
        dueDate: currentCycle.dueDate.toISOString().slice(0, 10),
        status: currentCycle.status,
        charges: currentCycle.charges.map((c) => ({
          id: c.id,
          userId: c.userId,
          displayName: c.user.displayName,
          pictureUrl: c.user.pictureUrl,
          amountBaht: satangToBaht(c.amountSatang),
          status: c.status,
          method: c.method,
          slipUrl: c.slipImagePath ? publicUrl(c.slipImagePath) : null,
          paidAt: c.paidAt?.toISOString() ?? null,
        })),
      }
      : null,
    currentUser: currentUserId
      ? {
        userId: currentUserId,
        displayName: profile?.displayName,
        isOwner: bill.ownerId === currentUserId,
        isParticipant: bill.participants.some((p) => p.userId === currentUserId),
        myCharge: currentCycle
          ? currentCycle.charges
            .filter((c) => c.userId === currentUserId)
            .map((c) => ({
              id: c.id,
              amountBaht: satangToBaht(c.amountSatang),
              status: c.status,
              method: c.method,
              slipUrl: c.slipImagePath ? publicUrl(c.slipImagePath) : null,
            }))[0] ?? null
          : null,
      }
      : null,
  });
});

// POST /api/bills/:id/join — เข้าร่วมบิลผ่าน LIFF
liffRouter.post('/bills/:id/join', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const bill = await getBillFull(req.params.id);
  if (!bill) return res.status(404).json({ error: 'not found' });
  if (bill.status !== BillStatus.OPEN_JOIN) return res.status(400).json({ error: 'บิลนี้ปิดรับสมาชิกแล้ว' });

  await upsertUser(profile.userId, profile.displayName, profile.pictureUrl);
  await syncGroupMember(bill.groupId, profile.userId);
  const { created } = await joinBill(bill.id, profile.userId);
  const count = await prisma.participant.count({ where: { billId: bill.id } });

  res.json({ ok: true, created, count });
});

const finalizeSchema = z.object({
  splitMode: z.enum([SplitMode.EQUAL, SplitMode.CUSTOM]),
  amounts: z.array(z.object({ userId: z.string(), baht: z.string() })).optional(),
});

// POST /api/bills/:id/finalize — ปิดรับสมาชิก + สร้างรอบแรก + ส่งการ์ดบิล
liffRouter.post('/bills/:id/finalize', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const bill = await getBillFull(req.params.id);
  if (!bill) return res.status(404).json({ error: 'not found' });
  if (bill.ownerId !== profile.userId) return res.status(403).json({ error: 'owner only' });
  if (bill.status !== BillStatus.OPEN_JOIN) return res.status(409).json({ error: 'already finalized' });
  if (bill.participants.length === 0) return res.status(400).json({ error: 'no participants' });

  const parsed = finalizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // โหมด CUSTOM: บันทึกยอดต่อคน + อัปเดต splitMode ของบิล
  if (parsed.data.splitMode === SplitMode.CUSTOM) {
    const amounts = parsed.data.amounts ?? [];
    const partIds = new Set(bill.participants.map((p) => p.userId));
    try {
      const mapped = amounts
        .filter((a) => partIds.has(a.userId))
        .map((a) => ({ userId: a.userId, customSatang: bahtToSatang(a.baht) }));
      if (mapped.length !== bill.participants.length) {
        return res.status(400).json({ error: 'ต้องกรอกยอดให้ครบทุกคน' });
      }
      await prisma.bill.update({ where: { id: bill.id }, data: { splitMode: SplitMode.CUSTOM } });
      await setCustomAmounts(bill.id, mapped);
    } catch {
      return res.status(400).json({ error: 'invalid amount' });
    }
  } else {
    if (bill.totalSatang == null) return res.status(400).json({ error: 'บิลนี้ไม่มียอดรวมสำหรับหารเท่ากัน' });
    await prisma.bill.update({ where: { id: bill.id }, data: { splitMode: SplitMode.EQUAL } });
  }

  const cycle = await finalizeBill(bill.id);
  await pushBillCard(bill.id, cycle.id);
  res.json({ ok: true, cycleId: cycle.id });
});

// POST /api/charges/:id/pay-slip — อัปโหลดไฟล์สลิปบน LIFF
liffRouter.post('/charges/:id/pay-slip', upload.single('slip'), async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์สลิป' });

  const charge = await getChargeFull(req.params.id);
  if (!charge) return res.status(404).json({ error: 'not found' });
  if (charge.userId !== profile.userId) return res.status(403).json({ error: 'not your charge' });
  if (charge.status === ChargeStatus.PAID) return res.status(400).json({ error: 'รายการนี้จ่ายเรียบร้อยแล้ว' });

  const path = await saveBuffer('slips', req.file.buffer, req.file.mimetype);
  const updated = await attachSlip(charge.id, path);

  res.json({ ok: true, chargeId: updated.id, status: updated.status });
});

// POST /api/charges/:id/pay-cash — แจ้งชำระเงินสดบน LIFF
liffRouter.post('/charges/:id/pay-cash', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const charge = await getChargeFull(req.params.id);
  if (!charge) return res.status(404).json({ error: 'not found' });
  if (charge.userId !== profile.userId) return res.status(403).json({ error: 'not your charge' });
  if (charge.status === ChargeStatus.PAID) return res.status(400).json({ error: 'รายการนี้จ่ายเรียบร้อยแล้ว' });

  const updated = await markCash(charge.id);
  res.json({ ok: true, chargeId: updated.id, status: updated.status });
});

const confirmSchema = z.object({
  approve: z.boolean(),
});

// POST /api/charges/:id/confirm — เจ้าของกดยืนยัน/ปฏิเสธการจ่ายบน LIFF
liffRouter.post('/charges/:id/confirm', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const charge = await getChargeFull(req.params.id);
  if (!charge) return res.status(404).json({ error: 'not found' });
  if (charge.cycle.bill.ownerId !== profile.userId) return res.status(403).json({ error: 'เฉพาะเจ้าของบิลเท่านั้น' });

  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.approve) {
    await confirmCharge(charge.id);
    const completed = await notifyIfCycleCompleted(charge.cycleId);
    res.json({ ok: true, action: 'approved', completed });
  } else {
    await rejectCharge(charge.id);
    res.json({ ok: true, action: 'rejected', completed: false });
  }
});

// ========================= Trip Bill (จดบิลทริป) =========================

/** map TripFull -> JSON (สตางค์ -> บาท) สำหรับ LIFF */
function tripToJson(trip: TripFull, currentUserId: string | null) {
  return {
    id: trip.id,
    title: trip.title,
    note: trip.note,
    status: trip.status,
    ownerId: trip.ownerId,
    ownerName: trip.owner.displayName,
    groupId: trip.groupId,
    members: trip.members.map((m) => ({
      memberId: m.id,
      userId: m.userId,
      displayName: m.user.displayName,
      pictureUrl: m.user.pictureUrl,
    })),
    items: trip.items.map((it) => ({
      id: it.id,
      name: it.name,
      remark: it.remark,
      priceBaht: satangToBaht(it.priceSatang),
      payerId: it.payerId,
      payerName: it.payer?.user.displayName ?? null,
      shares: it.shares.map((s) => ({
        memberId: s.memberId,
        fixedBaht: s.fixedSatang != null ? satangToBaht(s.fixedSatang) : null,
      })),
    })),
    currentUser: currentUserId
      ? {
        userId: currentUserId,
        isOwner: trip.ownerId === currentUserId,
        isMember: trip.members.some((m) => m.userId === currentUserId),
        memberId: trip.members.find((m) => m.userId === currentUserId)?.id ?? null,
      }
      : null,
  };
}

const shareSchema = z.object({
  memberId: z.string().min(1),
  fixedBaht: z.string().optional().nullable(),
});

const itemSchema = z.object({
  name: z.string().min(1).max(100),
  remark: z.string().max(300).optional().nullable(),
  priceBaht: z.string().min(1),
  payerId: z.string().optional().nullable(),
  shares: z.array(shareSchema).optional(),
});

/** แปลง shares (บาท) จาก payload -> สตางค์ (throw ถ้ารูปแบบผิด) */
function mapShares(shares?: { memberId: string; fixedBaht?: string | null }[]) {
  if (!shares) return undefined;
  return shares.map((s) => ({
    memberId: s.memberId,
    fixedSatang: s.fixedBaht != null && s.fixedBaht !== '' ? bahtToSatang(s.fixedBaht) : null,
  }));
}

const createTripSchema = z.object({
  groupId: z.string().min(1),
  title: z.string().min(1).max(100),
  note: z.string().max(300).optional(),
});

// POST /api/trips — สร้างทริปใหม่
liffRouter.post('/trips', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const parsed = createTripSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await upsertUser(profile.userId, profile.displayName, profile.pictureUrl);
  await upsertGroup(parsed.data.groupId);

  const trip = await createTrip({
    groupId: parsed.data.groupId,
    ownerId: profile.userId,
    title: parsed.data.title,
    note: parsed.data.note,
  });
  res.json({ ok: true, tripId: trip.id });
});

// GET /api/trips/:id — รายละเอียดทริป
liffRouter.get('/trips/:id', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  const trip = await getTripFull(req.params.id);
  if (!trip) return res.status(404).json({ error: 'not found' });
  res.json(tripToJson(trip, profile?.userId ?? null));
});

// POST /api/trips/:id/join — เข้าร่วมทริป
liffRouter.post('/trips/:id/join', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const trip = await getTripFull(req.params.id);
  if (!trip) return res.status(404).json({ error: 'not found' });
  if (trip.status !== TripStatus.OPEN) return res.status(400).json({ error: 'ทริปนี้ปิดแล้ว' });

  await upsertUser(profile.userId, profile.displayName, profile.pictureUrl);
  await syncGroupMember(trip.groupId, profile.userId);
  const { created } = await joinTrip(trip.id, profile.userId);
  const count = await prisma.tripMember.count({ where: { tripId: trip.id } });
  res.json({ ok: true, created, count });
});

// POST /api/trips/:id/items — เพิ่มรายการ
liffRouter.post('/trips/:id/items', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const trip = await getTripFull(req.params.id);
  if (!trip) return res.status(404).json({ error: 'not found' });
  if (trip.status !== TripStatus.OPEN) return res.status(409).json({ error: 'ทริปนี้ปิดแล้ว' });
  if (!trip.members.some((m) => m.userId === profile.userId)) {
    return res.status(403).json({ error: 'ต้องเข้าร่วมทริปก่อนเพิ่มรายการ' });
  }

  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const item = await addItem(trip.id, {
      name: parsed.data.name,
      remark: parsed.data.remark ?? undefined,
      priceSatang: bahtToSatang(parsed.data.priceBaht),
      payerId: parsed.data.payerId ?? null,
      shares: mapShares(parsed.data.shares),
    });
    res.json({ ok: true, itemId: item.id });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'invalid item' });
  }
});

// PATCH /api/trips/:id/items/:itemId — แก้ไขรายการ
liffRouter.patch('/trips/:id/items/:itemId', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const trip = await getTripFull(req.params.id);
  if (!trip) return res.status(404).json({ error: 'not found' });
  if (trip.status !== TripStatus.OPEN) return res.status(409).json({ error: 'ทริปนี้ปิดแล้ว' });
  if (!trip.members.some((m) => m.userId === profile.userId)) {
    return res.status(403).json({ error: 'ต้องเข้าร่วมทริปก่อนแก้ไข' });
  }

  const parsed = itemSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    await updateItem(trip.id, req.params.itemId, {
      name: parsed.data.name,
      remark: parsed.data.remark,
      priceSatang: parsed.data.priceBaht != null ? bahtToSatang(parsed.data.priceBaht) : undefined,
      payerId: parsed.data.payerId,
      shares: mapShares(parsed.data.shares),
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'invalid item' });
  }
});

// DELETE /api/trips/:id/items/:itemId — ลบรายการ
liffRouter.delete('/trips/:id/items/:itemId', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const trip = await getTripFull(req.params.id);
  if (!trip) return res.status(404).json({ error: 'not found' });
  if (trip.status !== TripStatus.OPEN) return res.status(409).json({ error: 'ทริปนี้ปิดแล้ว' });
  if (!trip.members.some((m) => m.userId === profile.userId)) {
    return res.status(403).json({ error: 'ต้องเข้าร่วมทริปก่อนลบ' });
  }

  await deleteItem(trip.id, req.params.itemId);
  res.json({ ok: true });
});

// GET /api/trips/:id/settle — สรุปยอด net settle
liffRouter.get('/trips/:id/settle', async (req, res) => {
  const trip = await getTripFull(req.params.id);
  if (!trip) return res.status(404).json({ error: 'not found' });

  try {
    const { totals, transfers } = await summarizeTrip(trip.id);
    const nameOf = (memberId: string) =>
      trip.members.find((m) => m.id === memberId)?.user.displayName ?? 'สมาชิก';
    res.json({
      perMember: trip.members.map((m) => ({
        memberId: m.id,
        displayName: m.user.displayName,
        paidBaht: satangToBaht(totals.paid.get(m.id) ?? 0),
        owedBaht: satangToBaht(totals.owed.get(m.id) ?? 0),
        netBaht: satangToBaht(totals.net.get(m.id) ?? 0),
      })),
      transfers: transfers.map((t) => ({
        fromId: t.from,
        fromName: nameOf(t.from),
        toId: t.to,
        toName: nameOf(t.to),
        baht: satangToBaht(t.satang),
      })),
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'สรุปไม่สำเร็จ' });
  }
});

// POST /api/trips/:id/finalize — ปิดทริป + ส่งสรุปเข้ากลุ่ม (เฉพาะเจ้าของ)
liffRouter.post('/trips/:id/finalize', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const trip = await getTripFull(req.params.id);
  if (!trip) return res.status(404).json({ error: 'not found' });
  if (trip.ownerId !== profile.userId) return res.status(403).json({ error: 'เฉพาะเจ้าของทริปเท่านั้น' });
  if (trip.status !== TripStatus.OPEN) return res.status(409).json({ error: 'ทริปนี้ปิดแล้ว' });

  try {
    await finalizeTrip(trip.id);
    await pushTripSummary(trip.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'ปิดทริปไม่สำเร็จ' });
  }
});
