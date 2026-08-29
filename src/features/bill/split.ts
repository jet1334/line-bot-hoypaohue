/**
 * แบ่งยอดรวม (สตางค์) ให้ n คนแบบเท่ากันที่สุด
 * เศษสตางค์ที่หารไม่ลงตัวจะกระจายให้คนแรกๆ ทีละ 1 สตางค์
 * รับประกันว่า sum(result) === totalSatang เป๊ะ
 *
 * ตัวอย่าง: splitEqualSatang(10000, 3) => [3334, 3333, 3333]  (100 บาท /3 คน)
 */
export function splitEqualSatang(totalSatang: number, n: number): number[] {
  if (!Number.isInteger(totalSatang) || totalSatang < 0) {
    throw new Error('totalSatang must be a non-negative integer');
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('n must be a positive integer');
  }
  const base = Math.floor(totalSatang / n);
  let remainder = totalSatang - base * n; // 0 <= remainder < n
  const shares: number[] = [];
  for (let i = 0; i < n; i++) {
    shares.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return shares;
}

/** แปลงบาท (อาจมีทศนิยม เช่น "33.34" หรือ number) เป็นสตางค์ integer */
export function bahtToSatang(input: string | number): number {
  const value = typeof input === 'number' ? input : Number(String(input).trim());
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid baht amount: ${input}`);
  }
  // ปัดเป็นสตางค์ที่ใกล้ที่สุด กัน floating point (เช่น 33.34 * 100 = 3333.9999)
  return Math.round(value * 100);
}

/** แปลงสตางค์ integer เป็นสตริงบาทสำหรับแสดงผล เช่น 3334 => "33.34" */
export function satangToBaht(satang: number): string {
  const sign = satang < 0 ? '-' : '';
  const abs = Math.abs(satang);
  const b = Math.floor(abs / 100);
  const s = abs % 100;
  return `${sign}${b.toLocaleString('en-US')}.${s.toString().padStart(2, '0')}`;
}
