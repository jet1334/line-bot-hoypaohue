import { prisma } from '../../db/prisma.js';

/** เพิ่มผู้เข้าร่วมบิล (idempotent — กดซ้ำไม่พัง) คืน { participant, created } */
export async function joinBill(billId: string, userId: string) {
  const existing = await prisma.participant.findUnique({
    where: { billId_userId: { billId, userId } },
  });
  if (existing) return { participant: existing, created: false };

  const participant = await prisma.participant.create({
    data: { billId, userId },
  });
  return { participant, created: true };
}

/** ถอนตัวออกจากบิล (ก่อน finalize) */
export async function leaveBill(billId: string, userId: string) {
  await prisma.participant.deleteMany({ where: { billId, userId } });
}

export function listParticipants(billId: string) {
  return prisma.participant.findMany({
    where: { billId },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
}
