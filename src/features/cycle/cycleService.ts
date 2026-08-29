import type { Bill } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BillStatus, ChargeStatus, CycleStatus, Recurrence } from '../../constants.js';

/** คำนวณวันครบกำหนดของรอบถัดไปจากวันครบกำหนดเดิม ตาม recurrence/interval */
export function computeNextDueDate(prev: Date, recurrence: string, interval: number): Date {
  const d = new Date(prev);
  switch (recurrence) {
    case Recurrence.DAILY:
      d.setDate(d.getDate() + interval);
      break;
    case Recurrence.WEEKLY:
      d.setDate(d.getDate() + 7 * interval);
      break;
    case Recurrence.MONTHLY:
      d.setMonth(d.getMonth() + interval);
      break;
    default:
      break;
  }
  return d;
}

/**
 * สร้าง cycle + charges สำหรับบิล โดยคัดลอกยอดจาก participants ปัจจุบัน
 * amountByUser: map userId -> สตางค์ (คำนวณไว้แล้วจาก finalize/split)
 */
export async function createCycle(
  billId: string,
  cycleNo: number,
  dueDate: Date,
  amountByUser: Map<string, number>,
) {
  return prisma.billCycle.create({
    data: {
      billId,
      cycleNo,
      dueDate,
      status: CycleStatus.COLLECTING,
      charges: {
        create: [...amountByUser.entries()].map(([userId, amountSatang]) => ({
          userId,
          amountSatang,
          status: ChargeStatus.UNPAID,
        })),
      },
    },
    include: { charges: true },
  });
}

/**
 * ตรวจว่า cycle จ่ายครบหรือยัง ถ้าครบ → mark COMPLETED
 * คืน true ถ้าเพิ่งเปลี่ยนเป็น COMPLETED ในการเรียกนี้
 */
export async function checkAndCompleteCycle(cycleId: string): Promise<boolean> {
  const cycle = await prisma.billCycle.findUnique({
    where: { id: cycleId },
    include: { charges: true },
  });
  if (!cycle || cycle.status === CycleStatus.COMPLETED) return false;

  const allPaid = cycle.charges.length > 0 && cycle.charges.every((c) => c.status === ChargeStatus.PAID);
  if (!allPaid) return false;

  await prisma.billCycle.update({
    where: { id: cycleId },
    data: { status: CycleStatus.COMPLETED },
  });
  return true;
}

/** map ยอดต่อคนจาก charges ของ cycle ก่อนหน้า (ใช้คัดลอกไปรอบถัดไป) */
export async function amountMapFromCycle(cycleId: string): Promise<Map<string, number>> {
  const charges = await prisma.charge.findMany({ where: { cycleId } });
  return new Map(charges.map((c) => [c.userId, c.amountSatang]));
}

/**
 * ตัดสินใจสร้างรอบถัดไปสำหรับบิลที่ทำซ้ำ (เรียกจาก scheduler หลัง cycle ปิด)
 * คืน cycle ใหม่ถ้าสร้าง, หรือ null ถ้าครบ repeatCount/ไม่ทำซ้ำ (พร้อม mark บิล DONE)
 */
export async function advanceRecurringBill(bill: Bill, lastCycleNo: number, lastDueDate: Date) {
  if (bill.recurrence === Recurrence.NONE) {
    await prisma.bill.update({ where: { id: bill.id }, data: { status: BillStatus.DONE } });
    return null;
  }
  if (bill.repeatCount != null && lastCycleNo >= bill.repeatCount) {
    await prisma.bill.update({ where: { id: bill.id }, data: { status: BillStatus.DONE } });
    return null;
  }

  // หา cycle ล่าสุดเพื่อคัดลอกยอด
  const latest = await prisma.billCycle.findFirst({
    where: { billId: bill.id },
    orderBy: { cycleNo: 'desc' },
  });
  if (!latest) return null;

  const amountByUser = await amountMapFromCycle(latest.id);
  if (amountByUser.size === 0) return null;

  const nextDue = computeNextDueDate(lastDueDate, bill.recurrence, bill.interval);
  return createCycle(bill.id, lastCycleNo + 1, nextDue, amountByUser);
}
