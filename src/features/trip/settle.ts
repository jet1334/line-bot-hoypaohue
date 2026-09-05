import { splitEqualSatang } from '../bill/split.js';

export interface ShareInput {
  memberId: string;
  /** null/undefined = ร่วมแบบหารเท่า; มีค่า = จ่ายยอดตรงนี้ (สตางค์) */
  fixedSatang?: number | null;
}

/**
 * แบ่งราคาของ item หนึ่งให้สมาชิกที่ร่วม
 * - คนที่มี fixedSatang จ่ายยอดนั้นตรงๆ
 * - ยอดที่เหลือ (price - Σfixed) หารเท่าให้คนที่ไม่ fixed
 * รับประกัน sum(result) === priceSatang เป๊ะ
 *
 * throw เมื่อ: ไม่มี share, fixed ติดลบ, Σfixed เกินราคา, มีเศษเหลือแต่ไม่มีคนหาร
 */
export function computeItemShares(priceSatang: number, shares: ShareInput[]): Map<string, number> {
  if (!Number.isInteger(priceSatang) || priceSatang < 0) {
    throw new Error('priceSatang must be a non-negative integer');
  }
  if (shares.length === 0) {
    throw new Error('item ต้องมีสมาชิกร่วมอย่างน้อย 1 คน');
  }

  const fixed = shares.filter((s) => s.fixedSatang != null);
  const equal = shares.filter((s) => s.fixedSatang == null);

  let fixedTotal = 0;
  for (const s of fixed) {
    const v = s.fixedSatang as number;
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`fixedSatang ต้องเป็นจำนวนเต็มไม่ติดลบ (memberId=${s.memberId})`);
    }
    fixedTotal += v;
  }

  if (fixedTotal > priceSatang) {
    throw new Error('ยอดจ่ายตรงรวมเกินราคา item');
  }

  const remain = priceSatang - fixedTotal;
  const result = new Map<string, number>();
  for (const s of fixed) {
    result.set(s.memberId, s.fixedSatang as number);
  }

  if (equal.length === 0) {
    if (remain !== 0) {
      throw new Error('มียอดเหลือแต่ไม่มีคนหารส่วนที่เหลือ');
    }
  } else {
    const portions = splitEqualSatang(remain, equal.length);
    equal.forEach((s, i) => result.set(s.memberId, portions[i]));
  }

  return result;
}

export interface ItemInput {
  priceSatang: number;
  /** TripMember id ผู้สำรองจ่าย; null = ยังไม่ระบุ (บล็อกการสรุป) */
  payerId: string | null;
  shares: ShareInput[];
}

export interface TripTotals {
  /** ยอดที่แต่ละคนต้องรับผิดชอบ (สตางค์) */
  owed: Map<string, number>;
  /** ยอดที่แต่ละคนสำรองจ่ายไปแล้ว (สตางค์) */
  paid: Map<string, number>;
  /** paid - owed: บวก = ควรได้คืน, ลบ = ต้องจ่าย */
  net: Map<string, number>;
}

/**
 * รวมทุก item เป็นยอดต่อคน
 * owed = ผลรวม share ที่รับผิดชอบ, paid = ผลรวมราคา item ที่เป็น payer
 * รับประกัน Σnet === 0
 * throw เมื่อ item ใดไม่มี payer
 */
export function computeTripTotals(items: ItemInput[]): TripTotals {
  const owed = new Map<string, number>();
  const paid = new Map<string, number>();

  const add = (m: Map<string, number>, key: string, v: number) => {
    m.set(key, (m.get(key) ?? 0) + v);
  };

  for (const item of items) {
    if (item.payerId == null) {
      throw new Error('มี item ที่ยังไม่ระบุคนสำรองจ่าย');
    }
    const itemShares = computeItemShares(item.priceSatang, item.shares);
    for (const [memberId, satang] of itemShares) {
      add(owed, memberId, satang);
    }
    add(paid, item.payerId, item.priceSatang);
  }

  const net = new Map<string, number>();
  for (const id of new Set([...owed.keys(), ...paid.keys()])) {
    net.set(id, (paid.get(id) ?? 0) - (owed.get(id) ?? 0));
  }

  return { owed, paid, net };
}

export interface Transfer {
  from: string;
  to: string;
  satang: number;
}

/**
 * แปลง net (paid-owed ต่อคน) เป็นรายการโอนแบบ greedy min-transfer
 * ลูกหนี้ (net<0) โอนให้เจ้าหนี้ (net>0) จับคู่ทีละคู่จนหมด
 * ต้องการ Σnet === 0 (ไม่งั้น throw)
 */
export function settle(net: Map<string, number>): Transfer[] {
  const total = [...net.values()].reduce((s, v) => s + v, 0);
  if (total !== 0) {
    throw new Error(`net ไม่สมดุล (Σ=${total}) — ต้องเป็น 0`);
  }

  // debtors: net<0 (แปลงเป็นยอดที่ต้องจ่าย บวก), creditors: net>0
  const debtors = [...net.entries()]
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, amount: -v }));
  const creditors = [...net.entries()]
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, amount: v }));

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const pay = Math.min(d.amount, c.amount);
    if (pay > 0) {
      transfers.push({ from: d.id, to: c.id, satang: pay });
      d.amount -= pay;
      c.amount -= pay;
    }
    if (d.amount === 0) i++;
    if (c.amount === 0) j++;
  }

  return transfers;
}
