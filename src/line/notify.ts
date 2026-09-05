import { lineClient } from './client.js';
import { billCard, joinCard, summaryCard, tripSummaryCard } from './flex.js';
import { getBillFull } from '../features/bill/billService.js';
import { summarizeTrip } from '../features/trip/tripService.js';
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

/** ส่งการ์ดสรุปทริป (net settle) เข้ากลุ่ม */
export async function pushTripSummary(tripId: string) {
  const { trip, totals, transfers } = await summarizeTrip(tripId);
  const card = tripSummaryCard({
    title: trip.title,
    members: trip.members.map((m) => ({ id: m.id, displayName: m.user.displayName })),
    perMember: trip.members.map((m) => ({
      memberId: m.id,
      paidSatang: totals.paid.get(m.id) ?? 0,
      owedSatang: totals.owed.get(m.id) ?? 0,
    })),
    transfers,
  });
  await lineClient.pushMessage({ to: trip.groupId, messages: [card] });
}
