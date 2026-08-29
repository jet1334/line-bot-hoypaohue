import { describe, it, expect } from 'vitest';
import { splitEqualSatang, bahtToSatang, satangToBaht } from './split.js';

describe('splitEqualSatang', () => {
  it('หารลงตัว', () => {
    expect(splitEqualSatang(10000, 4)).toEqual([2500, 2500, 2500, 2500]);
  });

  it('หารไม่ลงตัว กระจายเศษให้คนแรกๆ (100 บาท /3)', () => {
    expect(splitEqualSatang(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it('ผลรวมเท่ายอดรวมเสมอ ทุกกรณี', () => {
    for (let total = 0; total <= 5000; total += 7) {
      for (let n = 1; n <= 13; n++) {
        const shares = splitEqualSatang(total, n);
        expect(shares).toHaveLength(n);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('คนเดียวได้ทั้งหมด', () => {
    expect(splitEqualSatang(9999, 1)).toEqual([9999]);
  });

  it('โยน error เมื่อ input ไม่ถูกต้อง', () => {
    expect(() => splitEqualSatang(100, 0)).toThrow();
    expect(() => splitEqualSatang(-1, 2)).toThrow();
    expect(() => splitEqualSatang(1.5, 2)).toThrow();
  });
});

describe('bahtToSatang', () => {
  it('แปลงทศนิยมโดยไม่เพี้ยนจาก floating point', () => {
    expect(bahtToSatang('33.34')).toBe(3334);
    expect(bahtToSatang(0.1)).toBe(10);
    expect(bahtToSatang('1000')).toBe(100000);
    expect(bahtToSatang('19.99')).toBe(1999);
  });

  it('โยน error เมื่อค่าติดลบหรือไม่ใช่ตัวเลข', () => {
    expect(() => bahtToSatang('-5')).toThrow();
    expect(() => bahtToSatang('abc')).toThrow();
  });
});

describe('satangToBaht', () => {
  it('จัดรูปแบบ 2 ตำแหน่ง', () => {
    expect(satangToBaht(3334)).toBe('33.34');
    expect(satangToBaht(10)).toBe('0.10');
    expect(satangToBaht(100000)).toBe('1,000.00');
  });
});
