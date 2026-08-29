import cron from 'node-cron';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config.js';
import { lineClient } from '../../line/client.js';
import { buildMentionMessage } from '../../line/mention.js';
import { billCard } from '../../line/flex.js';
import { getBillFull } from '../bill/billService.js';
import { advanceRecurringBill } from './cycleService.js';
import { pushBillCard } from '../../line/notify.js';
import { BillStatus, ChargeStatus, CycleStatus, Recurrence } from '../../constants.js';

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** ทวงถามคนที่ยังไม่จ่าย (สถานะ UNPAID) ในรอบที่ถึง/เลยกำหนด */
export async function sendReminders(now = new Date()) {
  const cycles = await prisma.billCycle.findMany({
    where: { status: CycleStatus.COLLECTING, dueDate: { lte: now } },
    include: {
      charges: { include: { user: true } },
      bill: true,
    },
  });

  for (const cycle of cycles) {
    if (cycle.lastRemindedAt && isSameDay(cycle.lastRemindedAt, now)) continue;

    const unpaid = cycle.charges.filter((c) => c.status === ChargeStatus.UNPAID);
    if (unpaid.length === 0) continue;

    const people = unpaid.map((c) => ({ userId: c.userId, displayName: c.user.displayName }));
    const dueText = cycle.dueDate.toLocaleDateString('th-TH', { timeZone: config.TZ, dateStyle: 'medium' });
    const mention = buildMentionMessage(
      `⏰ ทวงบิล "${cycle.bill.title}" (ครบกำหนด ${dueText})\nยังไม่จ่าย: `,
      people,
      '\nโอนแล้วกด "จ่ายแล้ว" ที่การ์ดบิลได้เลยครับ 🙏',
    );

    const bill = await getBillFull(cycle.billId);
    const messages = bill ? [mention, billCard(bill, cycle.id)] : [mention];
    try {
      await lineClient.pushMessage({ to: cycle.bill.groupId, messages });
      await prisma.billCycle.update({ where: { id: cycle.id }, data: { lastRemindedAt: now } });
    } catch (err) {
      console.error('reminder push failed:', err);
    }
  }
}

/** สร้างรอบถัดไปให้บิลที่ทำซ้ำ เมื่อเลยวันครบกำหนดของรอบล่าสุด */
export async function advanceRecurring(now = new Date()) {
  const bills = await prisma.bill.findMany({
    where: { status: BillStatus.ACTIVE, recurrence: { not: Recurrence.NONE } },
  });

  for (const bill of bills) {
    const latest = await prisma.billCycle.findFirst({
      where: { billId: bill.id },
      orderBy: { cycleNo: 'desc' },
    });
    if (!latest) continue;
    if (now <= latest.dueDate) continue; // ยังไม่ถึงเวลาสร้างรอบใหม่

    // ครบจำนวนรอบแล้ว → ปิดบิลเมื่อทุกรอบจ่ายครบ
    if (bill.repeatCount != null && latest.cycleNo >= bill.repeatCount) {
      const remaining = await prisma.billCycle.count({
        where: { billId: bill.id, status: CycleStatus.COLLECTING },
      });
      if (remaining === 0) {
        await prisma.bill.update({ where: { id: bill.id }, data: { status: BillStatus.DONE } });
      }
      continue;
    }

    const next = await advanceRecurringBill(bill, latest.cycleNo, latest.dueDate);
    if (next) {
      await pushBillCard(bill.id, next.id);
    }
  }
}

export async function runDailyJob(now = new Date()) {
  console.log(`[scheduler] running daily job at ${now.toISOString()}`);
  await sendReminders(now);
  await advanceRecurring(now);
  console.log('[scheduler] daily job done');
}

export function startScheduler() {
  cron.schedule(config.REMINDER_CRON, () => runDailyJob().catch((e) => console.error('daily job error', e)), {
    timezone: config.TZ,
  });
  console.log(`[scheduler] scheduled "${config.REMINDER_CRON}" (${config.TZ})`);
}
