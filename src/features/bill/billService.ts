import { prisma } from '../../db/prisma.js';
import { BillStatus, CycleStatus, SplitMode } from '../../constants.js';
import { splitEqualSatang } from './split.js';
import { createCycle } from '../cycle/cycleService.js';

export interface CreateBillInput {
  groupId: string;
  ownerId: string;
  title: string;
  note?: string;
  splitMode: string; // EQUAL | CUSTOM
  totalSatang?: number; // required for EQUAL
  accountName?: string;
  accountNumber?: string;
  bankName?: string;
  qrImagePath?: string;
  recurrence: string;
  interval: number;
  repeatCount?: number | null;
  startDate: Date;
}

export async function createBill(input: CreateBillInput) {
  return prisma.bill.create({
    data: {
      groupId: input.groupId,
      ownerId: input.ownerId,
      title: input.title,
      note: input.note,
      splitMode: input.splitMode,
      totalSatang: input.splitMode === SplitMode.EQUAL ? input.totalSatang ?? null : null,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      bankName: input.bankName,
      qrImagePath: input.qrImagePath,
      recurrence: input.recurrence,
      interval: input.interval,
      repeatCount: input.repeatCount ?? null,
      startDate: input.startDate,
      status: BillStatus.OPEN_JOIN,
    },
  });
}

export function getBillFull(billId: string) {
  return prisma.bill.findUnique({
    where: { id: billId },
    include: {
      owner: true,
      group: true,
      participants: { include: { user: true }, orderBy: { createdAt: 'asc' } },
      cycles: {
        orderBy: { cycleNo: 'asc' },
        include: { charges: { include: { user: true } } },
      },
    },
  });
}

export type BillFull = NonNullable<Awaited<ReturnType<typeof getBillFull>>>;

/** คำนวณยอดต่อคนจาก participants ปัจจุบัน (ตาม splitMode) */
export function computeAmounts(bill: {
  splitMode: string;
  totalSatang: number | null;
  participants: { userId: string; customSatang: number | null }[];
}): Map<string, number> {
  const parts = bill.participants;
  if (parts.length === 0) return new Map();

  if (bill.splitMode === SplitMode.EQUAL) {
    if (bill.totalSatang == null) throw new Error('EQUAL bill missing totalSatang');
    const shares = splitEqualSatang(bill.totalSatang, parts.length);
    return new Map(parts.map((p, i) => [p.userId, shares[i]]));
  }
  // CUSTOM
  return new Map(
    parts.map((p) => {
      if (p.customSatang == null) throw new Error(`participant ${p.userId} missing customSatang`);
      return [p.userId, p.customSatang];
    }),
  );
}

/**
 * ปิดรับสมาชิก + สร้าง cycle แรก (cycleNo 1, dueDate = startDate)
 * คืน cycle ที่สร้าง
 */
export async function finalizeBill(billId: string) {
  const bill = await getBillFull(billId);
  if (!bill) throw new Error('bill not found');
  if (bill.status === BillStatus.ACTIVE || bill.cycles.length > 0) {
    throw new Error('bill already finalized');
  }
  if (bill.participants.length === 0) throw new Error('no participants');

  const amountByUser = computeAmounts(bill);
  const cycle = await createCycle(billId, 1, bill.startDate, amountByUser);
  await prisma.bill.update({ where: { id: billId }, data: { status: BillStatus.ACTIVE } });
  return cycle;
}

export async function cancelBill(billId: string) {
  return prisma.bill.update({ where: { id: billId }, data: { status: BillStatus.CANCELLED } });
}

/** อัปเดตยอดกำหนดเองต่อคน (โหมด CUSTOM) ก่อน finalize */
export async function setCustomAmounts(billId: string, amounts: { userId: string; customSatang: number }[]) {
  await prisma.$transaction(
    amounts.map((a) =>
      prisma.participant.update({
        where: { billId_userId: { billId, userId: a.userId } },
        data: { customSatang: a.customSatang },
      }),
    ),
  );
}
