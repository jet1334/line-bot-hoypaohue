import type { WebhookEvent, MessageEvent } from '@line/bot-sdk';
import { lineClient } from './client.js';
import { liffUrl } from './flex.js';
import { upsertGroup } from '../features/user.js';

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
    default:
      return;
  }
}

async function handleMessage(event: MessageEvent) {
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
            '1) พิมพ์ "สร้างบิล" ในกลุ่ม แล้วกดปุ่มเพื่อกรอกรายละเอียดบน LIFF\n' +
            '2) สมาชิกเปิด LIFF เพื่อกด "เข้าร่วมบิล"\n' +
            '3) เจ้าของกด "ปิดรับ & จัดการยอด" บน LIFF เพื่อส่งบิล\n' +
            '4) สมาชิกดูยอดและแนบสลิป/แจ้งชำระเงินบน LIFF\n' +
            '5) เจ้าของอนุมัติสลิปบน LIFF → ระบบสรุปเมื่อครบทุกคน',
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
