/**
 * ทดสอบ flow ทั้งระบบผ่าน service layer จริง (ไม่แตะ LINE API)
 * รันด้วย DB แยก: DATABASE_URL="file:./data/test.db" tsx scripts/flowtest.ts
 */
import { prisma } from '../src/db/prisma.js';
import { upsertUser, upsertGroup } from '../src/features/user.js';
import { createBill, finalizeBill, getBillFull } from '../src/features/bill/billService.js';
import { joinBill } from '../src/features/bill/participant.js';
import {
  attachSlip,
  markCash,
  confirmCharge,
  rejectCharge,
} from '../src/features/payment/paymentService.js';
import { checkAndCompleteCycle, advanceRecurringBill } from '../src/features/cycle/cycleService.js';
import { SplitMode, Recurrence, ChargeStatus, CycleStatus, BillStatus } from '../src/constants.js';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failures++;
  }
}

async function reset() {
  // ล้างข้อมูลเดิม (ตามลำดับ FK)
  await prisma.slipUploadState.deleteMany();
  await prisma.charge.deleteMany();
  await prisma.billCycle.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.user.deleteMany();
  await prisma.group.deleteMany();
}

async function main() {
  await reset();

  console.log('\n[setup] สร้างกลุ่มและผู้ใช้');
  await upsertGroup('G1', 'กลุ่มทดสอบ');
  await upsertUser('U_owner', 'เจ้าของบิล');
  await upsertUser('U_a', 'สมชาย');
  await upsertUser('U_b', 'สมหญิง');
  await upsertUser('U_c', 'สมศรี');

  console.log('\n[test 1] บิลหารเท่ากัน 100 บาท / 3 คน');
  const bill = await createBill({
    groupId: 'G1',
    ownerId: 'U_owner',
    title: 'ค่าน้ำค่าไฟ',
    splitMode: SplitMode.EQUAL,
    totalSatang: 10000,
    recurrence: Recurrence.NONE,
    interval: 1,
    startDate: new Date('2026-08-27T09:00:00+07:00'),
  });
  assert(bill.status === BillStatus.OPEN_JOIN, 'บิลเริ่มที่สถานะ OPEN_JOIN');

  await joinBill(bill.id, 'U_a');
  await joinBill(bill.id, 'U_b');
  const dup = await joinBill(bill.id, 'U_b'); // กดซ้ำ
  assert(dup.created === false, 'กดเข้าร่วมซ้ำไม่สร้างซ้ำ (idempotent)');
  await joinBill(bill.id, 'U_c');

  const cycle = await finalizeBill(bill.id);
  const amounts = cycle.charges.map((c) => c.amountSatang).sort((a, b) => b - a);
  assert(amounts.length === 3, 'สร้าง charge ครบ 3 คน');
  assert(amounts.reduce((a, b) => a + b, 0) === 10000, 'ผลรวมยอด = 100 บาทเป๊ะ');
  assert(JSON.stringify(amounts) === JSON.stringify([3334, 3333, 3333]), 'กระจายเศษ = [3334,3333,3333]');

  const billAfter = await getBillFull(bill.id);
  assert(billAfter?.status === BillStatus.ACTIVE, 'บิลเปลี่ยนเป็น ACTIVE หลัง finalize');

  console.log('\n[test 2] การจ่าย + ยืนยัน/ปฏิเสธ');
  const [c1, c2, c3] = cycle.charges;
  // c1 จ่ายเงินสด → PENDING → ยืนยัน → PAID
  await markCash(c1.id);
  let r1 = await prisma.charge.findUnique({ where: { id: c1.id } });
  assert(r1?.status === ChargeStatus.PENDING && r1?.method === 'CASH', 'จ่ายเงินสด → PENDING/CASH');
  await confirmCharge(c1.id);
  r1 = await prisma.charge.findUnique({ where: { id: c1.id } });
  assert(r1?.status === ChargeStatus.PAID, 'เจ้าของยืนยัน → PAID');

  // c2 แนบสลิป → PENDING → ปฏิเสธ → UNPAID
  await attachSlip(c2.id, 'uploads/slips/fake.jpg');
  let r2 = await prisma.charge.findUnique({ where: { id: c2.id } });
  assert(r2?.status === ChargeStatus.PENDING && r2?.slipImagePath === 'uploads/slips/fake.jpg', 'แนบสลิป → PENDING + เก็บ path');
  await rejectCharge(c2.id);
  r2 = await prisma.charge.findUnique({ where: { id: c2.id } });
  assert(r2?.status === ChargeStatus.UNPAID && r2?.slipImagePath === null, 'ปฏิเสธ → กลับ UNPAID + ล้างสลิป');

  console.log('\n[test 3] cycle จะครบก็ต่อเมื่อทุกคน PAID');
  let done = await checkAndCompleteCycle(cycle.id);
  assert(done === false, 'ยังไม่ครบ (c2,c3 ยังไม่จ่าย) → ไม่ COMPLETED');
  // จ่าย c2, c3 ให้ครบ
  await markCash(c2.id); await confirmCharge(c2.id);
  await markCash(c3.id); await confirmCharge(c3.id);
  done = await checkAndCompleteCycle(cycle.id);
  assert(done === true, 'จ่ายครบ → COMPLETED (คืน true ครั้งแรก)');
  const doneAgain = await checkAndCompleteCycle(cycle.id);
  assert(doneAgain === false, 'เรียกซ้ำ → false (ไม่ทำซ้ำ)');
  const cyc = await prisma.billCycle.findUnique({ where: { id: cycle.id } });
  assert(cyc?.status === CycleStatus.COMPLETED, 'สถานะ cycle = COMPLETED');

  console.log('\n[test 4] บิลกำหนดยอดเอง (CUSTOM) ทศนิยม');
  const bill2 = await createBill({
    groupId: 'G1', ownerId: 'U_owner', title: 'ทริปเที่ยว',
    splitMode: SplitMode.CUSTOM, recurrence: Recurrence.NONE, interval: 1,
    startDate: new Date('2026-08-27T09:00:00+07:00'),
  });
  await joinBill(bill2.id, 'U_a');
  await joinBill(bill2.id, 'U_b');
  await prisma.participant.update({ where: { billId_userId: { billId: bill2.id, userId: 'U_a' } }, data: { customSatang: 12550 } }); // 125.50
  await prisma.participant.update({ where: { billId_userId: { billId: bill2.id, userId: 'U_b' } }, data: { customSatang: 7025 } }); // 70.25
  const cyc2 = await finalizeBill(bill2.id);
  const byUser = new Map(cyc2.charges.map((c) => [c.userId, c.amountSatang]));
  assert(byUser.get('U_a') === 12550 && byUser.get('U_b') === 7025, 'CUSTOM ใช้ยอดต่อคนตามกำหนด (รองรับทศนิยม)');

  console.log('\n[test 5] ทำซ้ำ (DAILY, repeatCount 2)');
  const bill3 = await createBill({
    groupId: 'G1', ownerId: 'U_owner', title: 'ค่ากาแฟรายวัน',
    splitMode: SplitMode.EQUAL, totalSatang: 6000,
    recurrence: Recurrence.DAILY, interval: 1, repeatCount: 2,
    startDate: new Date('2026-08-27T09:00:00+07:00'),
  });
  await joinBill(bill3.id, 'U_a');
  await joinBill(bill3.id, 'U_b');
  const cyc3 = await finalizeBill(bill3.id);
  assert(cyc3.cycleNo === 1, 'รอบแรก cycleNo = 1');

  const b3 = await prisma.bill.findUnique({ where: { id: bill3.id } });
  const next = await advanceRecurringBill(b3!, 1, cyc3.dueDate);
  assert(next?.cycleNo === 2, 'สร้างรอบ 2 (คัดลอกยอด + เลื่อนวัน +1)');
  const nextDueDiff = (next!.dueDate.getTime() - cyc3.dueDate.getTime()) / 86400000;
  assert(Math.round(nextDueDiff) === 1, 'รอบ 2 ครบกำหนด +1 วัน');
  const nextAmounts = await prisma.charge.findMany({ where: { cycleId: next!.id } });
  assert(nextAmounts.every((c) => c.status === ChargeStatus.UNPAID) && nextAmounts.reduce((a, c) => a + c.amountSatang, 0) === 6000, 'รอบ 2 reset UNPAID + ยอดรวมคงเดิม');

  const b3b = await prisma.bill.findUnique({ where: { id: bill3.id } });
  const noMore = await advanceRecurringBill(b3b!, 2, next!.dueDate);
  assert(noMore === null, 'ครบ repeatCount=2 → ไม่สร้างรอบเพิ่ม');
  const b3c = await prisma.bill.findUnique({ where: { id: bill3.id } });
  assert(b3c?.status === BillStatus.DONE, 'บิลเปลี่ยนเป็น DONE เมื่อครบจำนวนรอบ');

  console.log(`\n${failures === 0 ? '✅ ทุกเทสต์ผ่าน' : `❌ ล้มเหลว ${failures} เทสต์`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
