import { prisma } from '../db/prisma.js';
import { lineClient } from '../line/client.js';

/** upsert ข้อมูลผู้ใช้ (จากโปรไฟล์ LINE) */
export async function upsertUser(userId: string, displayName: string, pictureUrl?: string) {
  return prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, displayName, pictureUrl },
    update: { displayName, pictureUrl },
  });
}

/** upsert กลุ่ม */
export async function upsertGroup(groupId: string, name?: string) {
  return prisma.group.upsert({
    where: { id: groupId },
    create: { id: groupId, name },
    update: name ? { name } : {},
  });
}

/**
 * ดึงชื่อสมาชิกในกลุ่มแล้ว upsert — ใช้ตอนกด "เข้าร่วมบิล"
 * getGroupMemberProfile ใช้ได้แม้ผู้ใช้ยังไม่ได้ add bot เป็นเพื่อน (ตราบใดที่อยู่ในกลุ่มเดียวกัน)
 */
export async function syncGroupMember(groupId: string, userId: string) {
  try {
    const profile = await lineClient.getGroupMemberProfile(groupId, userId);
    return upsertUser(userId, profile.displayName, profile.pictureUrl);
  } catch {
    // fallback ถ้าดึงโปรไฟล์ไม่ได้
    return prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, displayName: 'สมาชิก' },
      update: {},
    });
  }
}
