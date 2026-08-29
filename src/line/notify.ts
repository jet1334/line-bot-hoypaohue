import { lineClient } from './client.js';
import { billCard, joinCard, summaryCard, confirmPaymentCard } from './flex.js';
import { getBillFull } from '../features/bill/billService.js';
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

/** ส่งการ์ดให้เจ้าของยืนยันการจ่ายเข้ากลุ่ม */
export async function pushConfirmCard(charge: Parameters<typeof confirmPaymentCard>[0], groupId: string) {
  await lineClient.pushMessage({ to: groupId, messages: [confirmPaymentCard(charge)] });
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
