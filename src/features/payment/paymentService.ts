import { prisma } from '../../db/prisma.js';
import { ChargeStatus, PaymentMethod } from '../../constants.js';

const SLIP_STATE_TTL_MS = 15 * 60 * 1000; // 15 นาที

/** ตั้งสถานะรอแนบสลิปสำหรับ user (รูปถัดไปที่ส่งมา = สลิปของ charge นี้) */
export async function startSlipUpload(userId: string, chargeId: string) {
  const expiresAt = new Date(Date.now() + SLIP_STATE_TTL_MS);
  await prisma.slipUploadState.upsert({
    where: { userId },
    create: { userId, chargeId, expiresAt },
    update: { chargeId, expiresAt },
  });
}

/** ดึงสถานะรอแนบสลิปที่ยังไม่หมดอายุ */
export async function getPendingSlipUpload(userId: string) {
  const state = await prisma.slipUploadState.findUnique({ where: { userId } });
  if (!state) return null;
  if (state.expiresAt.getTime() < Date.now()) {
    await prisma.slipUploadState.delete({ where: { userId } }).catch(() => {});
    return null;
  }
  return state;
}

export async function clearSlipUpload(userId: string) {
  await prisma.slipUploadState.delete({ where: { userId } }).catch(() => {});
}

/** แนบสลิป → charge = PENDING (รอเจ้าของยืนยัน) */
export async function attachSlip(chargeId: string, slipImagePath: string) {
  await clearSlipUploadByCharge(chargeId);
  return prisma.charge.update({
    where: { id: chargeId },
    data: {
      status: ChargeStatus.PENDING,
      method: PaymentMethod.SLIP,
      slipImagePath,
      paidAt: new Date(),
    },
    include: { user: true, cycle: { include: { bill: true } } },
  });
}

/** แจ้งจ่ายเงินสด → charge = PENDING (รอเจ้าของยืนยัน) */
export async function markCash(chargeId: string) {
  return prisma.charge.update({
    where: { id: chargeId },
    data: {
      status: ChargeStatus.PENDING,
      method: PaymentMethod.CASH,
      slipImagePath: null,
      paidAt: new Date(),
    },
    include: { user: true, cycle: { include: { bill: true } } },
  });
}

/** เจ้าของยืนยันการจ่าย → PAID */
export async function confirmCharge(chargeId: string) {
  return prisma.charge.update({
    where: { id: chargeId },
    data: { status: ChargeStatus.PAID, confirmedAt: new Date() },
    include: { user: true, cycle: { include: { bill: true } } },
  });
}

/** เจ้าของปฏิเสธ → กลับเป็น UNPAID (ล้างข้อมูลการจ่าย) */
export async function rejectCharge(chargeId: string) {
  return prisma.charge.update({
    where: { id: chargeId },
    data: {
      status: ChargeStatus.UNPAID,
      method: null,
      slipImagePath: null,
      paidAt: null,
      confirmedAt: null,
    },
    include: { user: true, cycle: { include: { bill: true } } },
  });
}

async function clearSlipUploadByCharge(chargeId: string) {
  await prisma.slipUploadState.deleteMany({ where: { chargeId } }).catch(() => {});
}

export function getChargeFull(chargeId: string) {
  return prisma.charge.findUnique({
    where: { id: chargeId },
    include: { user: true, cycle: { include: { bill: { include: { owner: true } } } } },
  });
}
