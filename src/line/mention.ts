import type { messagingApi } from '@line/bot-sdk';

export interface MentionPerson {
  userId: string;
  displayName: string; // ใช้เป็น fallback/ข้อความ ไม่บังคับตรงกับที่ LINE แสดง
}

/**
 * สร้าง TextMessageV2 ที่ mention (tag) ผู้ใช้หลายคนในกลุ่ม
 * ใช้ substitution แบบ textV2 (SDK v9) — LINE จะเรนเดอร์ @ชื่อจริงจาก userId ให้เอง
 * รูปแบบผลลัพธ์: `${prefix}{u0} {u1} ...${suffix}`
 * หมายเหตุ: prefix/suffix ต้องไม่มีอักขระ { } ปนมา
 */
export function buildMentionMessage(
  prefix: string,
  people: MentionPerson[],
  suffix = '',
): messagingApi.TextMessageV2 {
  const substitution: Record<string, messagingApi.MentionSubstitutionObject> = {};
  let text = prefix;

  people.forEach((p, i) => {
    if (i > 0) text += ' ';
    const key = `u${i}`;
    text += `{${key}}`;
    substitution[key] = { type: 'mention', mentionee: { type: 'user', userId: p.userId } };
  });

  text += suffix;

  return { type: 'textV2', text, substitution };
}
