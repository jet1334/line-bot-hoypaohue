import express from 'express';
import path from 'node:path';
import { validateSignature, type WebhookRequestBody } from '@line/bot-sdk';
import { config } from './config.js';
import { handleEvents } from './line/webhook.js';
import { liffRouter } from './api/liffRoutes.js';
import { startScheduler } from './features/cycle/scheduler.js';

const app = express();

// ---- Webhook (ต้องใช้ raw body เพื่อตรวจ signature ก่อน parse) ----
app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const signature = req.header('x-line-signature') ?? '';
  const rawBody: Buffer = req.body;
  if (!validateSignature(rawBody, config.LINE_CHANNEL_SECRET, signature)) {
    return res.status(401).send('invalid signature');
  }
  const body = JSON.parse(rawBody.toString('utf-8')) as WebhookRequestBody;
  // ตอบ 200 ทันที แล้วประมวลผล event แบบ async (กัน LINE timeout/รีทราย)
  res.status(200).end();
  handleEvents(body.events).catch((err) => console.error('handleEvents error:', err));
});

// ---- JSON parser สำหรับ API อื่นๆ ----
app.use(express.json());

// ---- LIFF config (inject LIFF_ID ให้ frontend) ----
app.get('/liff/config.js', (_req, res) => {
  res.type('application/javascript');
  res.send(`window.LIFF_CONFIG = ${JSON.stringify({ liffId: config.LIFF_ID })};`);
});

// ---- Static: LIFF frontend + ไฟล์อัปโหลด (QR/สลิป) ----
app.use('/liff', express.static(path.resolve('public/liff')));
app.use('/uploads', express.static(path.resolve('data/uploads')));

// ---- REST API สำหรับ LIFF ----
app.use('/api', liffRouter);

// ---- Health check ----
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(config.PORT, () => {
  console.log(`✅ LINE Bill Bot listening on :${config.PORT}`);
  console.log(`   BASE_URL = ${config.BASE_URL}`);
  startScheduler();
});
