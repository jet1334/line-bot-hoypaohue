import type { WebhookEvent, PostbackEvent, MessageEvent } from '@line/bot-sdk';
import { lineClient, lineBlobClient } from './client.js';
import { liffUrl } from './flex.js';
import { upsertGroup, syncGroupMember } from '../features/user.js';
import { joinBill } from '../features/bill/participant.js';
import { getBillFull } from '../features/bill/billService.js';
import {
  startSlipUpload,
  getPendingSlipUpload,
  attachSlip,
  markCash,
  confirmCharge,
  rejectCharge,
  getChargeFull,
} from '../features/payment/paymentService.js';
import { pushBillCard, pushConfirmCard, notifyIfCycleCompleted, pushJoinCard } from './notify.js';
import { prisma } from '../db/prisma.js';
import { BillStatus, ChargeStatus } from '../constants.js';
import { saveStream } from '../storage/files.js';

export async function handleEvents(events: WebhookEvent[]) {
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('event handler error:', err);
    }
  }
}

async function handleEvent(event: WebhookEvent) {
  switch (event.type) {
    case 'join':
      if (event.source.type === 'group') {
        await upsertGroup(event.source.groupId);
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [
            {
              type: 'text',
              text: 'สวัสดีครับ 👋 ผมคือบอทเรียกเก็บเงินกลุ่ม\nพิมพ์ "สร้างบิล" เพื่อเริ่มสร้างบิลใหม่ได้เลย',
            },
          ],
        });
      }
      return;
    case 'follow':
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: 'text', text: 'ขอบคุณที่เพิ่มเพื่อน 🙏 เชิญผมเข้ากลุ่มแล้วพิมพ์ "สร้างบิล" เพื่อเริ่มใช้งานได้เลยครับ' },
        ],
      });
      return;
    case 'message':
      await handleMessage(event);
      return;
    case 'postback':
      await handlePostback(event);
      return;
    default:
      return;
  }
}

async function handleMessage(event: MessageEvent) {
  const userId = event.source.userId;

  // รูปภาพ = อาจเป็นสลิปที่รอแนบ
  if (event.message.type === 'image' && userId) {
    const pending = await getPendingSlipUpload(userId);
    if (!pending) return; // ไม่ได้อยู่ในขั้นตอนแนบสลิป → ไม่ทำอะไร
    await handleSlipImage(event, userId, pending.chargeId);
    return;
  }

  if (event.message.type !== 'text') return;
  const text = event.message.text.trim();

  if (/^(สร้างบิล|สร้าง|บิลใหม่|createbill|\/bill)$/i.test(text)) {
    await replyCreateBillPrompt(event);
    return;
  }

  if (/^(ช่วยเหลือ|help|วิธีใช้|\/help)$/i.test(text)) {
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: 'text',
          text:
            '📖 วิธีใช้งาน\n' +
            '1) พิมพ์ "สร้างบิล" ในกลุ่ม แล้วกรอกรายละเอียด\n' +
            '2) สมาชิกกดปุ่ม "เข้าร่วมบิล"\n' +
            '3) เจ้าของกด "ปิดรับ & จัดการยอด" เพื่อยืนยันยอด\n' +
            '4) แต่ละคนกด "จ่ายแล้ว/จ่ายเงินสด"\n' +
            '5) เจ้าของยืนยัน → ระบบสรุปเมื่อครบ',
        },
      ],
    });
    return;
  }
}

async function replyCreateBillPrompt(event: MessageEvent) {
  const src = event.source;
  if (src.type !== 'group') {
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'กรุณาพิมพ์ "สร้างบิล" ในกลุ่มที่ต้องการเรียกเก็บเงินครับ' }],
    });
    return;
  }
  await upsertGroup(src.groupId);
  const url = liffUrl({ view: 'create', groupId: src.groupId });
  await lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: [
      {
        type: 'template',
        altText: 'สร้างบิลใหม่',
        template: {
          type: 'buttons',
          title: '🧾 สร้างบิลใหม่',
          text: 'กดปุ่มด้านล่างเพื่อกรอกรายละเอียดบิล',
          actions: [{ type: 'uri', label: '➕ สร้างบิล', uri: url }],
        },
      },
    ],
  });
}

async function handleSlipImage(event: MessageEvent, userId: string, chargeId: string) {
  const messageId = event.message.id;
  const stream = await lineBlobClient.getMessageContent(messageId);
  const path = await saveStream('slips', stream, 'image/jpeg');

  const charge = await attachSlip(chargeId, path);
  await lineClient.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: '✅ ได้รับสลิปแล้ว รอเจ้าของบิลยืนยันนะครับ' }],
  });
  await pushConfirmCard(charge, charge.cycle.bill.groupId);
}

async function handlePostback(event: PostbackEvent) {
  const userId = event.source.userId;
  if (!userId) return;
  const params = new URLSearchParams(event.postback.data);
  const action = params.get('action');

  switch (action) {
    case 'join':
      await onJoin(event, userId, params.get('billId')!);
      return;
    case 'pay_slip':
      await onPaySlip(event, userId, params.get('cycleId')!);
      return;
    case 'pay_cash':
      await onPayCash(event, userId, params.get('cycleId')!);
      return;
    case 'confirm':
      await onConfirm(event, userId, params.get('chargeId')!, true);
      return;
    case 'reject':
      await onConfirm(event, userId, params.get('chargeId')!, false);
      return;
    default:
      return;
  }
}

async function onJoin(event: PostbackEvent, userId: string, billId: string) {
  const bill = await getBillFull(billId);
  if (!bill || bill.status !== BillStatus.OPEN_JOIN) {
    await reply(event, 'บิลนี้ปิดรับสมาชิกแล้วครับ');
    return;
  }
  const groupId = event.source.type === 'group' ? event.source.groupId : bill.groupId;
  await syncGroupMember(groupId, userId);
  const { created } = await joinBill(billId, userId);
  const count = await prisma.participant.count({ where: { billId } });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  await reply(
    event,
    created
      ? `✅ ${user?.displayName ?? 'คุณ'} เข้าร่วมบิล "${bill.title}" แล้ว (รวม ${count} คน)`
      : `${user?.displayName ?? 'คุณ'} อยู่ในบิลนี้อยู่แล้วครับ (รวม ${count} คน)`,
  );
}

async function onPaySlip(event: PostbackEvent, userId: string, cycleId: string) {
  const charge = await prisma.charge.findUnique({
    where: { cycleId_userId: { cycleId, userId } },
  });
  if (!charge) {
    await reply(event, 'คุณไม่ได้อยู่ในบิลรอบนี้ครับ');
    return;
  }
  if (charge.status === ChargeStatus.PAID) {
    await reply(event, 'รายการนี้ยืนยันแล้วว่าจ่ายครบ ✅');
    return;
  }
  await startSlipUpload(userId, charge.id);
  await reply(event, '📸 ส่งรูปสลิปการโอนเข้ามาในแชทได้เลยครับ (ภายใน 15 นาที)');
}

async function onPayCash(event: PostbackEvent, userId: string, cycleId: string) {
  const charge = await prisma.charge.findUnique({
    where: { cycleId_userId: { cycleId, userId } },
    include: { user: true, cycle: { include: { bill: true } } },
  });
  if (!charge) {
    await reply(event, 'คุณไม่ได้อยู่ในบิลรอบนี้ครับ');
    return;
  }
  if (charge.status === ChargeStatus.PAID) {
    await reply(event, 'รายการนี้ยืนยันแล้วว่าจ่ายครบ ✅');
    return;
  }
  const updated = await markCash(charge.id);
  await reply(event, '💵 แจ้งจ่ายเงินสดแล้ว รอเจ้าของบิลยืนยันนะครับ');
  await pushConfirmCard(updated, updated.cycle.bill.groupId);
}

async function onConfirm(event: PostbackEvent, userId: string, chargeId: string, approve: boolean) {
  const charge = await getChargeFull(chargeId);
  if (!charge) {
    await reply(event, 'ไม่พบรายการนี้ครับ');
    return;
  }
  if (charge.cycle.bill.ownerId !== userId) {
    await reply(event, 'เฉพาะเจ้าของบิลเท่านั้นที่ยืนยัน/ปฏิเสธได้ครับ');
    return;
  }
  if (approve) {
    const updated = await confirmCharge(chargeId);
    await reply(event, `✅ ยืนยันแล้ว: ${updated.user.displayName} จ่าย ${charge.cycle.bill.title} เรียบร้อย`);
    const completed = await notifyIfCycleCompleted(charge.cycleId);
    if (!completed) {
      // ส่งการ์ดบิลอัปเดตสถานะล่าสุดเข้ากลุ่ม
      await pushBillCard(charge.cycle.billId, charge.cycleId);
    }
  } else {
    const updated = await rejectCharge(chargeId);
    await reply(event, `❌ ปฏิเสธแล้ว: ${updated.user.displayName} ยังไม่จ่าย ${charge.cycle.bill.title}`);
  }
}

async function reply(event: PostbackEvent | MessageEvent, text: string) {
  await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text }] });
}
