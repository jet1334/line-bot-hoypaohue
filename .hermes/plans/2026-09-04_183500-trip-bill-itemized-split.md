# Trip Bill (Itemized Split) Implementation Plan

> **For Hermes:** Implement task-by-task. TDD where logic exists. Commit per task.

**Goal:** เพิ่มระบบ "จดบิลทริป" — จดรายการ (item) แบบ Splitwise: เข้าร่วมทริป, add item + ราคา, บาง item บางคนจ่ายตรง (fixed) ที่เหลือหารเท่า, remark ทุก item, มี payer ต่อ item, สรุปยอดสุทธิ (net settle) ว่าใครโอนใคร.

**Architecture:** ระบบใหม่แยกขาดจากบิลเก่า (ตาราง Prisma ใหม่ 4 ตัว ไม่แตะของเดิม). คำสั่ง `สร้างบิล` เปลี่ยนจากปุ่มเดียว → 2 ปุ่มให้เลือก "บิลเก็บเงิน (เดิม)" หรือ "จดบิลทริป (ใหม่)". หน้า LIFF ใหม่ `view=trip`. คำนวณเงินเป็นสตางค์ (integer) reuse `splitEqualSatang()`. v1 จบทริปแล้วโชว์ net settle + ส่งเข้ากลุ่ม (ยังไม่ต่อ charge/ไม่ track จ่าย).

**Tech Stack:** TypeScript + Express + Prisma + SQLite, LIFF static (public/liff), vitest.

---

## Decisions (locked)

| หัวข้อ | ค่า |
|--|--|
| แบ่งต่อ item | หารเท่า + ระบุยอดตรง (fixed) ได้ต่อคน; ยอดเหลือหารเท่าในคนที่ร่วมและไม่ fixed |
| ใครร่วม item | ค่าเริ่มต้น = ทุกคนในทริปร่วม; ติ๊กเอาออก/ตั้ง fixed ได้ต่อ item |
| payer | มี payer ต่อ item (ใครสำรองจ่าย) |
| สรุป | net settle (greedy min-transfer) โชว์ LIFF + ส่งเข้ากลุ่ม |
| เชื่อมระบบเดิม | `สร้างบิล` → 2 ปุ่มเลือกระบบ |
| หลังจบทริป (v1) | โชว์สรุปเฉยๆ ไม่ออก charge — *skipped: charge/track จ่าย, เพิ่มเมื่ออยากเก็บเงินจริง* |

## Assumptions
- LIFF_ID เดิมใช้ร่วมกัน (หน้า trip อยู่ใต้ /liff เดียวกัน แยกด้วย query `view=trip`).
- Auth = LIFF access token → `getProfileFromToken()` (pattern เดิมใน liffRoutes.ts).
- ต้องอยู่ในกลุ่ม LINE (มี groupId) เหมือนบิลเดิม.

---

## Data model (เพิ่มใน prisma/schema.prisma — ไม่แตะตารางเดิม)

```prisma
model Trip {
  id        String   @id @default(cuid())
  groupId   String
  ownerId   String
  title     String
  note      String?
  // status: OPEN | DONE | CANCELLED
  status    String   @default("OPEN")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  group     Group        @relation(fields: [groupId], references: [id])
  owner     User         @relation("TripOwner", fields: [ownerId], references: [id])
  members   TripMember[]
  items     TripItem[]

  @@index([groupId, status])
}

model TripMember {
  id        String   @id @default(cuid())
  tripId    String
  userId    String
  createdAt DateTime @default(now())

  trip      Trip     @relation(fields: [tripId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id])
  shares    TripItemShare[]
  paidItems TripItem[] @relation("ItemPayer")

  @@unique([tripId, userId])
}

model TripItem {
  id           String   @id @default(cuid())
  tripId       String
  name         String
  remark       String?
  priceSatang  Int
  // ผู้สำรองจ่าย = TripMember.id (nullable ระหว่างกรอก)
  payerId      String?
  createdAt    DateTime @default(now())

  trip         Trip     @relation(fields: [tripId], references: [id], onDelete: Cascade)
  payer        TripMember? @relation("ItemPayer", fields: [payerId], references: [id])
  shares       TripItemShare[]

  @@index([tripId])
}

model TripItemShare {
  id           String   @id @default(cuid())
  itemId       String
  memberId     String
  // null = ร่วมแบบหารเท่า; มีค่า = จ่ายยอดตรงนี้ (สตางค์)
  fixedSatang  Int?

  item         TripItem   @relation(fields: [itemId], references: [id], onDelete: Cascade)
  member       TripMember @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@unique([itemId, memberId])
}
```

ต้องเพิ่ม relation ฝั่งตรงข้ามใน model เดิม:
- `User`: `trips Trip[] @relation("TripOwner")`, `tripMembers TripMember[]`
- `Group`: `trips Trip[]`

---

## Files likely to change/create

- Modify: `prisma/schema.prisma` (เพิ่ม 4 model + relation ฝั่ง User/Group)
- Create: `src/features/trip/settle.ts` (คำนวณ share ต่อ item + net settle) + `settle.test.ts`
- Create: `src/features/trip/tripService.ts` (CRUD trip/item/share/member)
- Modify: `src/api/liffRoutes.ts` (เพิ่ม route กลุ่ม `/trips/*`)
- Modify: `src/line/webhook.ts` (`สร้างบิล` → 2 ปุ่ม; รองรับ start trip)
- Modify: `src/line/flex.ts` (helper สร้างการ์ดเลือกระบบ + การ์ดสรุปทริป — optional)
- Create: `public/liff/trip.html`, `public/liff/trip.js` (หน้ากรอกทริป) — reuse style.css เดิม
- Modify: `public/liff/index.html` หรือ app.js: routing `view=trip` → โหลด trip flow (ยึดตาม pattern liff.state เดิมใน memory)

---

## Split logic (settle.ts) — หัวใจ

### computeItemShares(item) → Map<memberId, satang>
1. รวบรวม shares ของ item: กลุ่ม `fixed` (มี fixedSatang) และกลุ่ม `equal` (null).
2. `fixedTotal = Σ fixedSatang`. ตรวจ `fixedTotal <= priceSatang` (ไม่งั้น error "ยอดจ่ายตรงเกินราคา item").
3. `remain = priceSatang - fixedTotal`. แบ่ง `remain` ให้กลุ่ม equal ด้วย `splitEqualSatang(remain, equalCount)`.
   - ถ้า `equalCount === 0` และ `remain !== 0` → error "ต้องมีคนหารส่วนที่เหลือ" (หรือถ้า remain==0 ก็ผ่าน).
4. ผลรวม fixed + equal = priceSatang เป๊ะ (invariant ต้อง assert).

### computeTripTotals(trip) → { owed: Map<memberId,satang>, paid: Map<memberId,satang>, net: Map<memberId,satang> }
- owed[member] += computeItemShares ต่อทุก item
- paid[payer] += item.priceSatang (payer สำรองจ่ายเต็มราคา)
- net = paid - owed (บวก = ควรได้คืน, ลบ = ต้องจ่าย)
- invariant: Σnet === 0

### settle(net) → [{ from, to, satang }]
- greedy: แยก debtors (net<0) และ creditors (net>0), sort, จับคู่ทีละคู่ min(|debt|, credit), ลดจนหมด.
- คืน list การโอน (ใครโอนใคร เท่าไหร่).

**Edge cases ต้องมี test:** เศษสตางค์หารไม่ลง, item ที่ fixed เต็มราคา (equalCount=0, remain=0), payer เดียวจ่ายหมด, สมาชิกไม่ร่วมบาง item, net ปัดแล้วยัง sum=0.

---

### Task 1: เพิ่ม Prisma models + migrate
**Files:** Modify `prisma/schema.prisma`

**Step 1:** เพิ่ม 4 model ข้างบน + relation ฝั่ง User/Group.
**Step 2:** รัน `npx prisma migrate dev --name add_trip_tables` (dev) หรือ `prisma migrate deploy` (prod). ตรวจ migration ไฟล์ถูกสร้าง.
**Step 3:** `npx prisma generate`.
**Step 4:** `npm run build` ผ่าน (type ของ prisma client ใหม่ครบ).
**Commit:** `feat(trip): add trip/item/share prisma models`

> **หมายเหตุ prod:** DB คือ `data/app.db` (SQLite) ใน container. migrate ต้องรันในคอนเทนเนอร์หรือ mount volume — ยืนยันวิธี migrate prod ก่อนรัน (ห้าม migrate reset).

### Task 2: settle.ts — computeItemShares (TDD)
**Files:** Create `src/features/trip/settle.ts`, `src/features/trip/settle.test.ts`
**Step 1:** เขียน test: item 100 บาท (10000 สตางค์), 3 คนหารเท่า → [3334,3333,3333]; 1 คน fixed 5000 อีก 2 คนหาร remain 5000 → [5000,2500,2500]; fixed เกินราคา → throw.
**Step 2:** รัน `npx vitest run src/features/trip/settle.test.ts` → FAIL.
**Step 3:** เขียน `computeItemShares` (reuse `splitEqualSatang`).
**Step 4:** vitest → PASS.
**Commit:** `feat(trip): item share computation`

### Task 3: settle.ts — computeTripTotals + settle (TDD)
**Files:** ต่อ `settle.ts` + test
**Step 1:** test net settle: 3 คน, 2 item ต่าง payer → ตรวจ Σnet=0 และ transfers ถูก (ผลรวมโอน = ยอดที่ debtor ติด).
**Step 2:** vitest FAIL → implement → PASS. assert invariant Σnet===0 ในโค้ด.
**Commit:** `feat(trip): net settle greedy min-transfer`

### Task 4: tripService.ts — CRUD
**Files:** Create `src/features/trip/tripService.ts`
- `createTrip({groupId, ownerId, title, note})` → สร้าง Trip(OPEN) + เพิ่ม owner เป็น member แรก.
- `joinTrip(tripId, userId)` → upsert TripMember.
- `getTripFull(tripId)` → include members.user, items.shares, items.payer.
- `addItem(tripId, {name, remark, priceSatang, payerId})` → สร้าง item + สร้าง TripItemShare ให้ทุก member (equal default).
- `updateItemShares(itemId, shares[])` → set fixed/เอาคนออก (validate ด้วย computeItemShares).
- `deleteItem(itemId)`, `finalizeTrip(tripId)` → status DONE (คำนวณสรุปด้วย settle).
**Step:** `npm run build` ผ่าน.
**Commit:** `feat(trip): trip service CRUD`

### Task 5: liffRoutes.ts — API `/trips/*`
**Files:** Modify `src/api/liffRoutes.ts`
- `POST /trips` (auth) — createTrip, คืน tripId. (zod schema)
- `GET /trips/:id` — getTripFull → map เป็น JSON (สตางค์→บาทด้วย satangToBaht).
- `POST /trips/:id/join` (auth) — joinTrip.
- `POST /trips/:id/items` (auth, owner/member) — addItem.
- `PATCH /trips/:id/items/:itemId` — updateItemShares/payer/remark.
- `DELETE /trips/:id/items/:itemId`.
- `GET /trips/:id/settle` — คืน { owed, paid, net, transfers } (บาท).
- `POST /trips/:id/finalize` (owner) — finalizeTrip + push สรุปเข้ากลุ่ม.
ยึด pattern เดิม: `getProfileFromToken`, upsertUser/syncGroupMember, zod validate, 401/403/404.
**Step:** `npm run build` ผ่าน.
**Commit:** `feat(trip): LIFF API routes`

### Task 6: webhook — `สร้างบิล` 2 ปุ่ม
**Files:** Modify `src/line/webhook.ts` (`replyCreateBillPrompt`)
- เปลี่ยน buttons template: 2 action —
  `➕ บิลเก็บเงิน` → `liffUrl({view:'create', groupId})` (เดิม)
  `✈️ จดบิลทริป` → `liffUrl({view:'trip', groupId})`
**Step:** ทดสอบ reply ในกลุ่ม (manual). `npm run build`.
**Commit:** `feat(trip): entry buttons on สร้างบิล`

### Task 7: LIFF frontend — trip.html/trip.js
**Files:** Create `public/liff/trip.html`, `public/liff/trip.js`; Modify routing (`app.js`/index) รองรับ `view=trip`.
- init liff, ดึง profile, groupId.
- flow: สร้างทริป (title) → เชิญเข้าร่วม (แชร์ลิงก์ `view=trip&tripId=`) → add item (name, price, payer, remark, ติ๊กคนร่วม/fixed) → หน้าสรุป settle.
- **สำคัญ (memory):** cache-bust `?v=BUILD_VERSION`, จัดการ liff.state fullyDecode + sessionStorage nav-intent เหมือนหน้าเดิม เพื่อกัน query หายหลัง OAuth. เปิดผ่าน `liff.line.me/{ID}?view=trip...` ในแอป LINE เท่านั้น.
- reuse `public/liff/style.css`.
**Step:** build image + เปิดใน LINE จริง.
**Commit:** `feat(trip): LIFF trip UI`

### Task 8: สรุปเข้ากลุ่ม (flex) + polish
**Files:** Modify `src/line/flex.ts` (+ notify ถ้าต้อง push)
- flex การ์ดสรุป: ยอดต่อคน + รายการโอน "A → B: 250".
- `finalizeTrip` push การ์ดนี้เข้ากลุ่ม.
**Commit:** `feat(trip): summary flex card`

---

## Tests / validation
- `npx vitest run src/features/trip/` — settle logic ผ่านหมด (Task 2-3 หัวใจ).
- `npm run build` ผ่านทุก task.
- Manual E2E ในแอป LINE: สร้างทริป → 3 คน join → เพิ่ม 3-4 item (มี fixed + payer ต่างกัน) → สรุป net settle → ตรวจเลขด้วยมือ 1 เคส.

## Risks / tradeoffs / open questions
- **Migrate prod SQLite:** ต้องรันใน container ที่ mount `data/`. อย่าใช้ `migrate reset`. ยืนยันขั้นตอนก่อนรัน Task 1 บน prod.
- **LIFF single-page vs หลายหน้า:** ใช้ query `view=trip` แยก flow — ต้องระวัง liff.state query หาย (pitfall เดิมใน memory). ทางเลือก: หน้า trip.html แยกไฟล์ vs รวมใน index.html+router. เลือกแยกไฟล์เพื่อความชัด แต่ endpoint LIFF ตั้ง `/liff/` root อยู่แล้ว → router ต้อง handle.
- **payer nullable:** ถ้า finalize โดยมี item ไม่มี payer → บล็อก + แจ้ง "item X ยังไม่ระบุคนจ่าย".
- **v1 ไม่ track การจ่ายจริง** — แค่บอกว่าใครควรโอนใคร. ถ้าอยากติดตาม/แนบสลิป = เฟสถัดไป (ต่อกับ Charge เดิมได้).
- **Open:** ต้องการ edit/ลบทริปหลัง finalize ไหม? (ตอนนี้ finalize = DONE, อ่านอย่างเดียว)
