import { describe, it, expect } from 'vitest';
import { computeItemShares, computeTripTotals, settle } from './settle.js';
import type { ItemInput } from './settle.js';

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
    const r = computeItemShares(10000, shares(['a', 5000], 'b', 'c'));
    expect(r.get('a')).toBe(5000);
    expect(r.get('b')).toBe(2500);
    expect(r.get('c')).toBe(2500);
    expect([...r.values()].reduce((s, v) => s + v, 0)).toBe(10000);
  });

  it('fixed หลายคน + เศษหารไม่ลงตัว', () => {
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

  it('มี remain แต่ไม่มีคนหาร — throw', () => {
    expect(() => computeItemShares(10000, shares(['a', 3000]))).toThrow();
  });

  it('ไม่มี share เลย — throw', () => {
    expect(() => computeItemShares(10000, shares())).toThrow();
  });

  it('fixed เป็นค่าติดลบ — throw', () => {
    expect(() => computeItemShares(10000, shares(['a', -100], 'b'))).toThrow();
  });
});

describe('computeTripTotals', () => {
  it('owed/paid/net ต่อคน + Σnet=0', () => {
    // a จ่ายมื้อ 30000 (a,b,c หาร => 10000 each)
    // b จ่ายแท็กซี่ 9000 (a,b,c หาร => 3000 each)
    const items: ItemInput[] = [
      { priceSatang: 30000, payerId: 'a', shares: shares('a', 'b', 'c') },
      { priceSatang: 9000, payerId: 'b', shares: shares('a', 'b', 'c') },
    ];
    const t = computeTripTotals(items);
    // owed: a=10000+3000=13000, b=10000+3000=13000, c=13000
    expect(t.owed.get('a')).toBe(13000);
    expect(t.owed.get('b')).toBe(13000);
    expect(t.owed.get('c')).toBe(13000);
    // paid: a=30000, b=9000, c=0
    expect(t.paid.get('a')).toBe(30000);
    expect(t.paid.get('b')).toBe(9000);
    expect(t.paid.get('c') ?? 0).toBe(0);
    // net = paid - owed: a=+17000, b=-4000, c=-13000
    expect(t.net.get('a')).toBe(17000);
    expect(t.net.get('b')).toBe(-4000);
    expect(t.net.get('c')).toBe(-13000);
    // Σnet = 0
    expect([...t.net.values()].reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('payer เป็น null — throw (ต้องระบุคนจ่ายก่อนสรุป)', () => {
    const items: ItemInput[] = [{ priceSatang: 10000, payerId: null, shares: shares('a', 'b') }];
    expect(() => computeTripTotals(items)).toThrow();
  });

  it('trip ว่าง — net ทุกคน 0', () => {
    const t = computeTripTotals([]);
    expect(t.net.size).toBe(0);
  });
});

describe('settle', () => {
  it('จับคู่โอน — Σโอน = Σหนี้, ปลายทางถูก', () => {
    const net = new Map([['a', 17000], ['b', -4000], ['c', -13000]]);
    const transfers = settle(net);
    // ลูกหนี้ b,c จ่ายให้เจ้าหนี้ a
    const totalMoved = transfers.reduce((s, t) => s + t.satang, 0);
    expect(totalMoved).toBe(17000);
    // ทุก transfer: from เป็นลูกหนี้ (net<0), to เป็นเจ้าหนี้ (net>0)
    for (const t of transfers) {
      expect(net.get(t.from)!).toBeLessThan(0);
      expect(net.get(t.to)!).toBeGreaterThan(0);
      expect(t.satang).toBeGreaterThan(0);
    }
    // ยอดรับสุทธิของ a = 17000
    const recvA = transfers.filter((t) => t.to === 'a').reduce((s, t) => s + t.satang, 0);
    expect(recvA).toBe(17000);
    // ยอดจ่ายของ c = 13000, b = 4000
    const payC = transfers.filter((t) => t.from === 'c').reduce((s, t) => s + t.satang, 0);
    const payB = transfers.filter((t) => t.from === 'b').reduce((s, t) => s + t.satang, 0);
    expect(payC).toBe(13000);
    expect(payB).toBe(4000);
  });

  it('ทุกคน net=0 — ไม่มีการโอน', () => {
    const net = new Map([['a', 0], ['b', 0]]);
    expect(settle(net).length).toBe(0);
  });

  it('2 เจ้าหนี้ 1 ลูกหนี้ — split ถูก', () => {
    const net = new Map([['a', 5000], ['b', 3000], ['c', -8000]]);
    const transfers = settle(net);
    const payC = transfers.filter((t) => t.from === 'c').reduce((s, t) => s + t.satang, 0);
    expect(payC).toBe(8000);
    const recvA = transfers.filter((t) => t.to === 'a').reduce((s, t) => s + t.satang, 0);
    const recvB = transfers.filter((t) => t.to === 'b').reduce((s, t) => s + t.satang, 0);
    expect(recvA).toBe(5000);
    expect(recvB).toBe(3000);
  });
});
