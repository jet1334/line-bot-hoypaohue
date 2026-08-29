import type { messagingApi } from '@line/bot-sdk';
import { config } from '../config.js';
import { satangToBaht } from '../features/bill/split.js';
import { ChargeStatus, PaymentMethod, Recurrence } from '../constants.js';
import type { BillFull } from '../features/bill/billService.js';
import { publicUrl } from '../storage/files.js';

type FlexMessage = messagingApi.FlexMessage;
type FlexBox = messagingApi.FlexBox;

const COLOR = {
  primary: '#06C755', // LINE green
  gray: '#8C8C8C',
  dark: '#111111',
  danger: '#E03131',
  pending: '#F08C00',
};

export function liffUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `https://liff.line.me/${config.LIFF_ID}?${qs}`;
}

const RECURRENCE_LABEL: Record<string, string> = {
  [Recurrence.NONE]: 'ครั้งเดียว',
  [Recurrence.DAILY]: 'ทุกวัน',
  [Recurrence.WEEKLY]: 'ทุกสัปดาห์',
  [Recurrence.MONTHLY]: 'ทุกเดือน',
};

function formatDate(d: Date): string {
  return d.toLocaleDateString('th-TH', {
    timeZone: config.TZ,
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

function recurrenceText(bill: BillFull): string {
  if (bill.recurrence === Recurrence.NONE) return RECURRENCE_LABEL[Recurrence.NONE];
  const every = bill.interval > 1 ? `ทุกๆ ${bill.interval} ` : '';
  const unit =
    bill.recurrence === Recurrence.DAILY ? 'วัน' : bill.recurrence === Recurrence.WEEKLY ? 'สัปดาห์' : 'เดือน';
  const count = bill.repeatCount ? ` (${bill.repeatCount} ครั้ง)` : '';
  return `${every ? every + unit : RECURRENCE_LABEL[bill.recurrence]}${count}`;
}

function statusIcon(status: string): string {
  if (status === ChargeStatus.PAID) return '✅';
  if (status === ChargeStatus.PENDING) return '⏳';
  return '⬜';
}

/** การ์ดเชิญเข้าร่วมบิล (สถานะ OPEN_JOIN) */
export function joinCard(bill: BillFull): FlexMessage {
  const names = bill.participants.map((p) => p.user.displayName);
  const participantBox: FlexBox = {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    contents:
      names.length > 0
        ? names.map((n) => ({ type: 'text', text: `• ${n}`, size: 'sm', color: COLOR.dark }))
        : [{ type: 'text', text: 'ยังไม่มีคนเข้าร่วม', size: 'sm', color: COLOR.gray }],
  };

  return {
    type: 'flex',
    altText: `📢 บิลใหม่: ${bill.title} — กดเพื่อเข้าร่วม`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.primary,
        paddingAll: 'lg',
        contents: [
          { type: 'text', text: '📢 บิลเรียกเก็บเงิน', color: '#FFFFFF', size: 'sm' },
          { type: 'text', text: bill.title, color: '#FFFFFF', size: 'xl', weight: 'bold', wrap: true },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          infoRow('การเรียกเก็บ', recurrenceText(bill)),
          infoRow('ครบกำหนด', formatDate(bill.startDate)),
          infoRow(
            'การแบ่งยอด',
            bill.splitMode === 'EQUAL'
              ? `หารเท่ากัน (รวม ${satangToBaht(bill.totalSatang ?? 0)} บ.)`
              : 'กำหนดเอง',
          ),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: `ผู้เข้าร่วม (${names.length})`, size: 'sm', weight: 'bold', color: COLOR.gray },
          participantBox,
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLOR.primary,
            action: { type: 'postback', label: '🙋 เข้าร่วมบิล', data: `action=join&billId=${bill.id}`, displayText: 'ขอเข้าร่วมบิล' },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'uri',
              label: '⚙️ ปิดรับ & จัดการยอด (เจ้าของ)',
              uri: liffUrl({ view: 'manage', billId: bill.id }),
            },
          },
        ],
      },
    },
  };
}

/** การ์ดบิลหลัก (หลัง finalize) แสดงยอดต่อคน + สถานะ + ปุ่มจ่าย */
export function billCard(bill: BillFull, cycleId: string): FlexMessage {
  const cycle = bill.cycles.find((c) => c.id === cycleId) ?? bill.cycles[bill.cycles.length - 1];
  const charges = cycle?.charges ?? [];

  const rows: FlexBox[] = charges.map((c) => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: `${statusIcon(c.status)} ${c.user.displayName}`, size: 'sm', color: COLOR.dark, flex: 5, wrap: true },
      { type: 'text', text: `${satangToBaht(c.amountSatang)} บ.`, size: 'sm', align: 'end', flex: 3, color: c.status === ChargeStatus.PAID ? COLOR.primary : COLOR.dark },
    ],
  }));

  const accountContents: messagingApi.FlexComponent[] = [];
  if (bill.accountNumber) {
    accountContents.push(infoRow('บัญชี', `${bill.bankName ?? ''} ${bill.accountNumber}`.trim()));
    if (bill.accountName) accountContents.push(infoRow('ชื่อบัญชี', bill.accountName));
  }

  const bubble: messagingApi.FlexBubble = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: COLOR.primary,
      paddingAll: 'lg',
      contents: [
        { type: 'text', text: '💰 บิลเรียกเก็บเงิน', color: '#FFFFFF', size: 'sm' },
        { type: 'text', text: bill.title, color: '#FFFFFF', size: 'xl', weight: 'bold', wrap: true },
        { type: 'text', text: `รอบที่ ${cycle?.cycleNo ?? 1} • ครบกำหนด ${cycle ? formatDate(cycle.dueDate) : '-'}`, color: '#E8FFF3', size: 'xs' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: 'รายการเรียกเก็บ', size: 'sm', weight: 'bold', color: COLOR.gray },
        ...rows,
        ...(accountContents.length ? [{ type: 'separator', margin: 'md' } as messagingApi.FlexComponent, ...accountContents] : []),
        ...(bill.note ? [{ type: 'text', text: `📝 ${bill.note}`, size: 'xs', color: COLOR.gray, wrap: true, margin: 'md' } as messagingApi.FlexComponent] : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLOR.primary,
          action: { type: 'postback', label: '💸 จ่ายแล้ว (แนบสลิป)', data: `action=pay_slip&cycleId=${cycle?.id}`, displayText: 'ฉันจ่ายแล้ว (แนบสลิป)' },
        },
        {
          type: 'button',
          style: 'secondary',
          action: { type: 'postback', label: '💵 จ่ายเงินสด', data: `action=pay_cash&cycleId=${cycle?.id}`, displayText: 'ฉันจ่ายเงินสด' },
        },
      ],
    },
  };

  if (bill.qrImagePath) {
    bubble.hero = {
      type: 'image',
      url: publicUrl(bill.qrImagePath),
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'fit',
      backgroundColor: '#FFFFFF',
    };
  }

  return { type: 'flex', altText: `💰 บิล ${bill.title} — ดูยอดและจ่ายเงิน`, contents: bubble };
}

/** การ์ดให้เจ้าของยืนยันการจ่าย (สลิป/เงินสด) */
export function confirmPaymentCard(charge: {
  id: string;
  amountSatang: number;
  method: string | null;
  slipImagePath: string | null;
  user: { displayName: string };
  cycle: { bill: { title: string } };
}): FlexMessage {
  const isSlip = charge.method === PaymentMethod.SLIP;
  const bubble: messagingApi.FlexBubble = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: '🔔 รอเจ้าของยืนยันการจ่าย', size: 'sm', weight: 'bold', color: COLOR.pending },
        { type: 'text', text: charge.cycle.bill.title, size: 'md', weight: 'bold', wrap: true },
        infoRow('ผู้จ่าย', charge.user.displayName),
        infoRow('ยอด', `${satangToBaht(charge.amountSatang)} บ.`),
        infoRow('ช่องทาง', isSlip ? 'โอน (แนบสลิป)' : 'เงินสด'),
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLOR.primary,
          action: { type: 'postback', label: '✅ ยืนยัน', data: `action=confirm&chargeId=${charge.id}`, displayText: 'ยืนยันการจ่าย' },
        },
        {
          type: 'button',
          style: 'secondary',
          action: { type: 'postback', label: '❌ ปฏิเสธ', data: `action=reject&chargeId=${charge.id}`, displayText: 'ปฏิเสธการจ่าย' },
        },
      ],
    },
  };

  if (isSlip && charge.slipImagePath) {
    bubble.hero = {
      type: 'image',
      url: publicUrl(charge.slipImagePath),
      size: 'full',
      aspectRatio: '3:4',
      aspectMode: 'fit',
      backgroundColor: '#FFFFFF',
    };
  }

  return { type: 'flex', altText: `🔔 ${charge.user.displayName} แจ้งจ่าย ${charge.cycle.bill.title}`, contents: bubble };
}

/** การ์ดสรุปเมื่อจ่ายครบทุกคน */
export function summaryCard(bill: BillFull, cycleId: string): FlexMessage {
  const cycle = bill.cycles.find((c) => c.id === cycleId);
  const charges = cycle?.charges ?? [];
  const total = charges.reduce((sum, c) => sum + c.amountSatang, 0);

  const rows: messagingApi.FlexComponent[] = charges.map((c) => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: `✅ ${c.user.displayName}`, size: 'sm', flex: 5, wrap: true },
      { type: 'text', text: `${satangToBaht(c.amountSatang)} บ.`, size: 'sm', align: 'end', flex: 3, color: COLOR.primary },
      { type: 'text', text: c.method === PaymentMethod.CASH ? 'เงินสด' : 'โอน', size: 'xs', align: 'end', flex: 2, color: COLOR.gray },
    ],
  }));

  return {
    type: 'flex',
    altText: `🎉 บิล ${bill.title} เก็บครบแล้ว`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.primary,
        paddingAll: 'lg',
        contents: [
          { type: 'text', text: '🎉 เก็บเงินครบแล้ว!', color: '#FFFFFF', size: 'lg', weight: 'bold' },
          { type: 'text', text: `${bill.title} • รอบที่ ${cycle?.cycleNo ?? 1}`, color: '#E8FFF3', size: 'xs', wrap: true },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          ...rows,
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'รวมทั้งสิ้น', size: 'sm', weight: 'bold', flex: 5 },
              { type: 'text', text: `${satangToBaht(total)} บ.`, size: 'sm', weight: 'bold', align: 'end', flex: 5, color: COLOR.primary },
            ],
          },
        ],
      },
    },
  };
}

function infoRow(label: string, value: string): FlexBox {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: COLOR.gray, flex: 4 },
      { type: 'text', text: value, size: 'sm', color: COLOR.dark, flex: 6, wrap: true, align: 'end' },
    ],
  };
}
