// รันงานรายวันแบบ manual (สำหรับทดสอบ) — จำลอง "วันถัดไป" ได้ด้วยการส่ง arg วันที่
// ตัวอย่าง: npm run job:daily -- 2026-09-01
import { runDailyJob } from '../features/cycle/scheduler.js';
import { prisma } from '../db/prisma.js';

const arg = process.argv[2];
const now = arg ? new Date(`${arg}T09:00:00+07:00`) : new Date();

runDailyJob(now)
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
