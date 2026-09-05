import { describe, it, expect } from 'vitest';
import { computeItemShares } from './settle.js';

// helper: item share input
type ShareIn = { memberId: string; fixedSatang?: number | null };
function shares(...ids: (string | [string, number])[]): ShareIn[] {
  return ids.map((x) =>
    Array.isArray(x) ? { memberId: x[0], fixedSatang: x[1] } : { memberId: x, fixedSatang: null },
  );
}

describe('computeItemShares', () => {
  it('หารเท่า 3 คน — เศษกระจายคนแรก', () => {
    const r = computeItemShares(10000, shares('a', 'b', 'c'));
    expect(r.get('a')).toBe(3334);
    expect(r.get('b')).toBe(3333);
    expect(r.get('c')).toBe(3333);
    expect([...r.values()].reduce((s, v) => s + v, 0)).toBe(10000);
  });

  it('fixed 1 คน + หารเท่าที่เหลือ 2 คน', () => {
    // ราคา 10000, a จ่ายตรง 5000, b+c หาร 5000 = 2500 each
    const r = computeItemShares(10000, shares(['a', 5000], 'b', 'c'));
    expect(r.get('a')).toBe(5000);
    expect(r.get('b')).toBe(2500);
    expect(r.get('c')).toBe(2500);
    expect([...r.values()].reduce((s, v) => s + v, 0)).toBe(10000);
  });

  it('fixed หลายคน + เศษหารไม่ลงตัว', () => {
    // ราคา 10000, a fixed 1000, b+c+d หาร 9000 => 3000,3000,3000
    const r = computeItemShares(10000, shares(['a', 1000], 'b', 'c', 'd'));
    expect(r.get('a')).toBe(1000);
    expect([...r.values()].reduce((s, v) => s + v, 0)).toBe(10000);
  });

  it('fixed เต็มราคา — ไม่มีคนหารเหลือ (remain=0) ผ่านได้', () => {
    const r = computeItemShares(10000, shares(['a', 6000], ['b', 4000]));
    expect(r.get('a')).toBe(6000);
    expect(r.get('b')).toBe(4000);
    expect([...r.values()].reduce((s, v) => s + v, 0)).toBe(10000);
  });

  it('fixed รวมเกินราคา — throw', () => {
    expect(() => computeItemShares(10000, shares(['a', 7000], ['b', 4000]))).toThrow();
  });

  it('มี remain แต่ไม่มีคนหาร (ทุกคน fixed แต่ไม่ครบราคา) — throw', () => {
    // a fixed 3000, ราคา 10000, เหลือ 7000 ไม่มีคนหาร => error
    expect(() => computeItemShares(10000, shares(['a', 3000]))).toThrow();
  });

  it('ไม่มี share เลย — throw', () => {
    expect(() => computeItemShares(10000, shares())).toThrow();
  });

  it('fixed เป็นค่าติดลบ — throw', () => {
    expect(() => computeItemShares(10000, shares(['a', -100], 'b'))).toThrow();
  });
});
