# LINE Bill Bot — บอทเรียกเก็บเงินกลุ่ม

บอท LINE สำหรับสร้างบิลเรียกเก็บเงินในกลุ่มแชท: เจ้าของสร้างบิลเอง เลือกวันครบกำหนด ตั้งเรียกเก็บซ้ำ (วัน/สัปดาห์/เดือน) หารเท่ากันหรือกำหนดยอดต่อคน (รองรับทศนิยม) แนบเลขบัญชี+QR รับสลิป/เงินสด เจ้าของยืนยันการจ่าย ทวงถามคนค้างอัตโนมัติ และสรุปเมื่อครบ

## ฟีเจอร์
- 🧾 สร้างบิลผ่านฟอร์ม LIFF ในแอป LINE
- 🙋 สมาชิกกดปุ่ม "เข้าร่วมบิล" (แก้ข้อจำกัดที่ LINE ดึงรายชื่อสมาชิกกลุ่มไม่ได้)
- ➗ หารเท่ากัน (กระจายเศษสตางค์ให้ผลรวมตรงเป๊ะ) หรือกำหนดยอดเอง
- 💸 จ่ายด้วยสลิปโอน (แนบรูปเป็นหลักฐาน) หรือเงินสด → เจ้าของกดยืนยัน
- 🔁 เรียกเก็บซ้ำอัตโนมัติ + กำหนดจำนวนรอบ
- ⏰ ทวงถามคนยังไม่จ่ายทุกวัน (mention ในกลุ่ม)
- 🎉 สรุปเมื่อจ่ายครบ

## Stack
Node.js + TypeScript · Express · @line/bot-sdk (v9) · Prisma + SQLite · node-cron · LIFF (vanilla JS)

---

## 1) ตั้งค่า LINE (ทำครั้งเดียว)
1. ไปที่ [LINE Developers Console](https://developers.line.biz/) → สร้าง **Provider** → สร้าง **Messaging API channel**
2. ในแท็บ **Messaging API**:
   - คัดลอก **Channel access token** (long-lived) → `LINE_CHANNEL_ACCESS_TOKEN`
   - ปิด **Auto-reply messages** และ **Greeting messages** (ที่ LINE Official Account Manager)
   - เปิด **Use webhook** และตั้ง **Webhook URL** = `https://<BASE_URL>/webhook`
   - อนุญาต **Allow bot to join group chats**
3. ในแท็บ **Basic settings**: คัดลอก **Channel secret** → `LINE_CHANNEL_SECRET`
4. สร้าง **LIFF app** (แท็บ LIFF):
   - Endpoint URL = `https://<BASE_URL>/liff/`
   - Size = **Full**
   - Scope: `profile`, `openid`
   - คัดลอก **LIFF ID** → `LIFF_ID`

> `BASE_URL` ต้องเป็น HTTPS ที่ LINE เข้าถึงได้ (โดเมนของ VPS หรือ URL จาก cloudflared tunnel ตอน dev)

## 2) ตั้งค่า env
```bash
cp .env.example .env
# แก้ค่าใน .env ให้ครบ
```

## 3) รัน (dev)
```bash
npm install
npx prisma migrate dev        # สร้าง/อัปเดตฐานข้อมูล
npm run dev                    # รันที่ http://localhost:3000
# เปิด tunnel ให้ LINE เข้าถึง (ตัวอย่าง)
cloudflared tunnel --url http://localhost:3000
# นำ URL https ที่ได้ไปตั้งเป็น BASE_URL และ Webhook URL
```

## 4) รัน (production, Docker บน VPS)
```bash
# ให้ reverse proxy (Caddy/Nginx) ทำ HTTPS ชี้มาที่พอร์ต 3000
docker compose up -d --build
```

## การใช้งาน
1. เชิญบอทเข้ากลุ่ม → พิมพ์ **"สร้างบิล"**
2. กรอกฟอร์ม → บอทโพสต์การ์ดเชิญเข้าร่วม
3. สมาชิกกด **"เข้าร่วมบิล"**
4. เจ้าของกด **"ปิดรับ & จัดการยอด"** → เลือกหารเท่ากัน/กำหนดยอด → ส่งบิล
5. แต่ละคนกด **"จ่ายแล้ว (แนบสลิป)"** หรือ **"จ่ายเงินสด"**
6. เจ้าของกด **"ยืนยัน"** → ครบทุกคนระบบสรุปให้อัตโนมัติ

## ทดสอบ scheduler (จำลองวันถัดไป)
```bash
npm run job:daily                 # รันด้วยเวลาปัจจุบัน
npm run job:daily -- 2026-09-01    # จำลองว่าเป็นวันที่กำหนด (ทวง/ขึ้นรอบใหม่)
```

## หมายเหตุด้านความปลอดภัย
- ไฟล์ใน `/uploads` (QR/สลิป) เสิร์ฟแบบ public ด้วยชื่อสุ่ม (uuid) — เหมาะระดับ MVP; หากต้องการเข้มขึ้นให้เพิ่ม signed URL/auth
- ตัวตนผู้ใช้ใน API ยืนยันผ่าน LIFF access token (เรียก LINE `/v2/profile`)
