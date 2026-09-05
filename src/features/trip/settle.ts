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
