import { lineClient } from './client.js';
import { billCard, joinCard, summaryCard } from './flex.js';
import { getBillFull } from '../features/bill/billService.js';
import { summarizeTrip } from '../features/trip/tripService.js';
import { satangToBaht } from '../features/bill/split.js';
import { checkAndCompleteCycle } from '../features/cycle/cycleService.js';
import { prisma } from '../db/prisma.js';

/** ส่งการ์ดเชิญเข้าร่วมเข้ากลุ่ม */
export async function pushJoinCard(billId: string) {
  const bill = await getBillFull(billId);
  if (!bill) return;
  await lineClient.pushMessage({ to: bill.groupId, messages: [joinCard(bill)] });
}

/** ส่งการ์ดบิลหลัก (หลัง finalize หรือขึ้นรอบใหม่) เข้ากลุ่ม */
export async function pushBillCard(billId: string, cycleId: string) {
  const bill = await getBillFull(billId);
  if (!bill) return;
  await lineClient.pushMessage({ to: bill.groupId, messages: [billCard(bill, cycleId)] });
}

/**
 * เรียกหลังเจ้าของยืนยันการจ่าย 1 รายการ:
 * ถ้า cycle ครบทุกคน → mark COMPLETED + ส่งการ์ดสรุปเข้ากลุ่ม
 * คืน true ถ้าเพิ่งครบในรอบนี้
 */
export async function notifyIfCycleCompleted(cycleId: string): Promise<boolean> {
  const completed = await checkAndCompleteCycle(cycleId);
  if (!completed) return false;

  const cycle = await prisma.billCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) return false;
  const bill = await getBillFull(cycle.billId);
  if (!bill) return false;

  await lineClient.pushMessage({ to: bill.groupId, messages: [summaryCard(bill, cycleId)] });
  return true;
}

/** ส่งข้อความสรุปทริป (net settle) เข้ากลุ่ม — v1 เป็น text (flex ใน Task 8) */
export async function pushTripSummary(tripId: string) {
  const { trip, totals, transfers } = await summarizeTrip(tripId);
  const nameOf = (memberId: string) =>
    trip.members.find((m) => m.id === memberId)?.user.displayName ?? 'สมาชิก';

  const lines: string[] = [`🧾 สรุปทริป: ${trip.title}`, ''];
  lines.push('ยอดต่อคน (จ่ายจริง / ส่วนที่ต้องรับผิดชอบ):');
  for (const m of trip.members) {
    const paid = totals.paid.get(m.id) ?? 0;
    const owed = totals.owed.get(m.id) ?? 0;
    lines.push(`• ${m.user.displayName}: จ่าย ${satangToBaht(paid)} / ควรจ่าย ${satangToBaht(owed)}`);
  }
  lines.push('');
  if (transfers.length === 0) {
    lines.push('✅ ไม่มียอดต้องโอน (สมดุลแล้ว)');
  } else {
    lines.push('💸 รายการโอน:');
    for (const t of transfers) {
      lines.push(`• ${nameOf(t.from)} → ${nameOf(t.to)}: ${satangToBaht(t.satang)} บาท`);
    }
  }

  await lineClient.pushMessage({ to: trip.groupId, messages: [{ type: 'text', text: lines.join('\n') }] });
}
