import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { upsertUser, upsertGroup, syncGroupMember } from '../features/user.js';
import { createBill, getBillFull, finalizeBill, setCustomAmounts } from '../features/bill/billService.js';
import { joinBill } from '../features/bill/participant.js';
import { bahtToSatang, satangToBaht } from '../features/bill/split.js';
import { saveBuffer, publicUrl } from '../storage/files.js';
import { pushJoinCard, pushBillCard, notifyIfCycleCompleted } from '../line/notify.js';
import { attachSlip, markCash, confirmCharge, rejectCharge, getChargeFull } from '../features/payment/paymentService.js';
import { BillStatus, ChargeStatus, Recurrence, SplitMode } from '../constants.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
export const liffRouter = Router();

/** ตรวจ LIFF access token → คืนโปรไฟล์ผู้ใช้ (userId ที่เชื่อถือได้) */
async function getProfileFromToken(authHeader?: string) {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const res = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as { userId: string; displayName: string; pictureUrl?: string };
}

const createSchema = z.object({
  groupId: z.string().min(1),
  title: z.string().min(1).max(100),
  note: z.string().max(300).optional(),
  splitMode: z.enum([SplitMode.EQUAL, SplitMode.CUSTOM]),
  totalBaht: z.string().optional(), // required เมื่อ EQUAL
  accountName: z.string().max(100).optional(),
  accountNumber: z.string().max(50).optional(),
  bankName: z.string().max(50).optional(),
  recurrence: z.enum([Recurrence.NONE, Recurrence.DAILY, Recurrence.WEEKLY, Recurrence.MONTHLY]),
  interval: z.coerce.number().int().min(1).max(365).default(1),
  repeatCount: z.coerce.number().int().min(1).max(365).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function parseDate(dateStr: string): Date {
  // ตีความเป็นเวลา 09:00 ตามเขตเวลาไทย
  return new Date(`${dateStr}T09:00:00+07:00`);
}

// POST /api/bills — สร้างบิลใหม่ (multipart รองรับไฟล์ QR field ชื่อ "qr")
liffRouter.post('/bills', upload.single('qr'), async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  let totalSatang: number | undefined;
  if (data.splitMode === SplitMode.EQUAL) {
    if (!data.totalBaht) return res.status(400).json({ error: 'totalBaht required for EQUAL' });
    try {
      totalSatang = bahtToSatang(data.totalBaht);
    } catch {
      return res.status(400).json({ error: 'invalid totalBaht' });
    }
    if (totalSatang <= 0) return res.status(400).json({ error: 'totalBaht must be > 0' });
  }

  await upsertUser(profile.userId, profile.displayName, profile.pictureUrl);
  await upsertGroup(data.groupId);

  let qrImagePath: string | undefined;
  if (req.file) {
    qrImagePath = await saveBuffer('qr', req.file.buffer, req.file.mimetype);
  }

  const bill = await createBill({
    groupId: data.groupId,
    ownerId: profile.userId,
    title: data.title,
    note: data.note,
    splitMode: data.splitMode,
    totalSatang,
    accountName: data.accountName,
    accountNumber: data.accountNumber,
    bankName: data.bankName,
    qrImagePath,
    recurrence: data.recurrence,
    interval: data.interval,
    repeatCount: data.repeatCount ?? null,
    startDate: parseDate(data.startDate),
  });

  await pushJoinCard(bill.id);
  res.json({ ok: true, billId: bill.id });
});

// GET /api/bills/:id — รายละเอียดบิล (สำหรับหน้า manage)
liffRouter.get('/bills/:id', async (req, res) => {
  const bill = await getBillFull(req.params.id);
  if (!bill) return res.status(404).json({ error: 'not found' });
  res.json({
    id: bill.id,
    title: bill.title,
    status: bill.status,
    splitMode: bill.splitMode,
    totalBaht: bill.totalSatang != null ? satangToBaht(bill.totalSatang) : null,
    ownerId: bill.ownerId,
    participants: bill.participants.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      pictureUrl: p.user.pictureUrl,
      customBaht: p.customSatang != null ? satangToBaht(p.customSatang) : null,
    })),
  });
});

// GET /api/bills/:id/detail — ดึงรายละเอียดบิลฉบับสมบูรณ์สำหรับแสดงผลบน LIFF
liffRouter.get('/bills/:id/detail', async (req, res) => {
  const bill = await getBillFull(req.params.id);
  if (!bill) return res.status(404).json({ error: 'not found' });

  const profile = await getProfileFromToken(req.headers.authorization);
  const currentUserId = profile?.userId ?? null;

  const currentCycle = bill.cycles[bill.cycles.length - 1] ?? null;

  res.json({
    id: bill.id,
    title: bill.title,
    note: bill.note,
    status: bill.status,
    splitMode: bill.splitMode,
    totalBaht: bill.totalSatang != null ? satangToBaht(bill.totalSatang) : null,
    ownerId: bill.ownerId,
    ownerName: bill.owner.displayName,
    bankName: bill.bankName,
    accountNumber: bill.accountNumber,
    accountName: bill.accountName,
    qrUrl: bill.qrImagePath ? publicUrl(bill.qrImagePath) : null,
    participants: bill.participants.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      pictureUrl: p.user.pictureUrl,
    })),
    currentCycle: currentCycle
      ? {
        id: currentCycle.id,
        cycleNo: currentCycle.cycleNo,
        dueDate: currentCycle.dueDate.toISOString().slice(0, 10),
        status: currentCycle.status,
        charges: currentCycle.charges.map((c) => ({
          id: c.id,
          userId: c.userId,
          displayName: c.user.displayName,
          pictureUrl: c.user.pictureUrl,
          amountBaht: satangToBaht(c.amountSatang),
          status: c.status,
          method: c.method,
          slipUrl: c.slipImagePath ? publicUrl(c.slipImagePath) : null,
          paidAt: c.paidAt?.toISOString() ?? null,
        })),
      }
      : null,
    currentUser: currentUserId
      ? {
        userId: currentUserId,
        displayName: profile?.displayName,
        isOwner: bill.ownerId === currentUserId,
        isParticipant: bill.participants.some((p) => p.userId === currentUserId),
        myCharge: currentCycle
          ? currentCycle.charges
            .filter((c) => c.userId === currentUserId)
            .map((c) => ({
              id: c.id,
              amountBaht: satangToBaht(c.amountSatang),
              status: c.status,
              method: c.method,
              slipUrl: c.slipImagePath ? publicUrl(c.slipImagePath) : null,
            }))[0] ?? null
          : null,
      }
      : null,
  });
});

// POST /api/bills/:id/join — เข้าร่วมบิลผ่าน LIFF
liffRouter.post('/bills/:id/join', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const bill = await getBillFull(req.params.id);
  if (!bill) return res.status(404).json({ error: 'not found' });
  if (bill.status !== BillStatus.OPEN_JOIN) return res.status(400).json({ error: 'บิลนี้ปิดรับสมาชิกแล้ว' });

  await upsertUser(profile.userId, profile.displayName, profile.pictureUrl);
  await syncGroupMember(bill.groupId, profile.userId);
  const { created } = await joinBill(bill.id, profile.userId);
  const count = await prisma.participant.count({ where: { billId: bill.id } });

  res.json({ ok: true, created, count });
});

const finalizeSchema = z.object({
  splitMode: z.enum([SplitMode.EQUAL, SplitMode.CUSTOM]),
  amounts: z.array(z.object({ userId: z.string(), baht: z.string() })).optional(),
});

// POST /api/bills/:id/finalize — ปิดรับสมาชิก + สร้างรอบแรก + ส่งการ์ดบิล
liffRouter.post('/bills/:id/finalize', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const bill = await getBillFull(req.params.id);
  if (!bill) return res.status(404).json({ error: 'not found' });
  if (bill.ownerId !== profile.userId) return res.status(403).json({ error: 'owner only' });
  if (bill.status !== BillStatus.OPEN_JOIN) return res.status(409).json({ error: 'already finalized' });
  if (bill.participants.length === 0) return res.status(400).json({ error: 'no participants' });

  const parsed = finalizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // โหมด CUSTOM: บันทึกยอดต่อคน + อัปเดต splitMode ของบิล
  if (parsed.data.splitMode === SplitMode.CUSTOM) {
    const amounts = parsed.data.amounts ?? [];
    const partIds = new Set(bill.participants.map((p) => p.userId));
    try {
      const mapped = amounts
        .filter((a) => partIds.has(a.userId))
        .map((a) => ({ userId: a.userId, customSatang: bahtToSatang(a.baht) }));
      if (mapped.length !== bill.participants.length) {
        return res.status(400).json({ error: 'ต้องกรอกยอดให้ครบทุกคน' });
      }
      await prisma.bill.update({ where: { id: bill.id }, data: { splitMode: SplitMode.CUSTOM } });
      await setCustomAmounts(bill.id, mapped);
    } catch {
      return res.status(400).json({ error: 'invalid amount' });
    }
  } else {
    if (bill.totalSatang == null) return res.status(400).json({ error: 'บิลนี้ไม่มียอดรวมสำหรับหารเท่ากัน' });
    await prisma.bill.update({ where: { id: bill.id }, data: { splitMode: SplitMode.EQUAL } });
  }

  const cycle = await finalizeBill(bill.id);
  await pushBillCard(bill.id, cycle.id);
  res.json({ ok: true, cycleId: cycle.id });
});

// POST /api/charges/:id/pay-slip — อัปโหลดไฟล์สลิปบน LIFF
liffRouter.post('/charges/:id/pay-slip', upload.single('slip'), async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์สลิป' });

  const charge = await getChargeFull(req.params.id);
  if (!charge) return res.status(404).json({ error: 'not found' });
  if (charge.userId !== profile.userId) return res.status(403).json({ error: 'not your charge' });
  if (charge.status === ChargeStatus.PAID) return res.status(400).json({ error: 'รายการนี้จ่ายเรียบร้อยแล้ว' });

  const path = await saveBuffer('slips', req.file.buffer, req.file.mimetype);
  const updated = await attachSlip(charge.id, path);

  res.json({ ok: true, chargeId: updated.id, status: updated.status });
});

// POST /api/charges/:id/pay-cash — แจ้งชำระเงินสดบน LIFF
liffRouter.post('/charges/:id/pay-cash', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const charge = await getChargeFull(req.params.id);
  if (!charge) return res.status(404).json({ error: 'not found' });
  if (charge.userId !== profile.userId) return res.status(403).json({ error: 'not your charge' });
  if (charge.status === ChargeStatus.PAID) return res.status(400).json({ error: 'รายการนี้จ่ายเรียบร้อยแล้ว' });

  const updated = await markCash(charge.id);
  res.json({ ok: true, chargeId: updated.id, status: updated.status });
});

const confirmSchema = z.object({
  approve: z.boolean(),
});

// POST /api/charges/:id/confirm — เจ้าของกดยืนยัน/ปฏิเสธการจ่ายบน LIFF
liffRouter.post('/charges/:id/confirm', async (req, res) => {
  const profile = await getProfileFromToken(req.headers.authorization);
  if (!profile) return res.status(401).json({ error: 'unauthorized' });

  const charge = await getChargeFull(req.params.id);
  if (!charge) return res.status(404).json({ error: 'not found' });
  if (charge.cycle.bill.ownerId !== profile.userId) return res.status(403).json({ error: 'เฉพาะเจ้าของบิลเท่านั้น' });

  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.approve) {
    await confirmCharge(charge.id);
    const completed = await notifyIfCycleCompleted(charge.cycleId);
    res.json({ ok: true, action: 'approved', completed });
  } else {
    await rejectCharge(charge.id);
    res.json({ ok: true, action: 'rejected', completed: false });
  }
});
