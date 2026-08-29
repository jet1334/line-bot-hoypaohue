import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';

// data/uploads/{qr,slips}
const UPLOAD_ROOT = path.resolve('data', 'uploads');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function extFromContentType(contentType?: string): string {
  if (!contentType) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

/** เซฟ buffer (จาก multer upload ของ LIFF) เช่น QR — คืน path สัมพัทธ์ที่ใช้ประกอบ public URL */
export async function saveBuffer(
  subdir: string,
  buffer: Buffer,
  contentType?: string,
): Promise<string> {
  const dir = path.join(UPLOAD_ROOT, subdir);
  await ensureDir(dir);
  const filename = `${uuid()}.${extFromContentType(contentType)}`;
  await fs.writeFile(path.join(dir, filename), buffer);
  return `uploads/${subdir}/${filename}`;
}

/** เซฟจาก stream (จาก getMessageContent ของ LINE) เช่น สลิป — คืน path สัมพัทธ์ */
export async function saveStream(
  subdir: string,
  stream: Readable,
  contentType?: string,
): Promise<string> {
  const dir = path.join(UPLOAD_ROOT, subdir);
  await ensureDir(dir);
  const filename = `${uuid()}.${extFromContentType(contentType)}`;
  await pipeline(stream, createWriteStream(path.join(dir, filename)));
  return `uploads/${subdir}/${filename}`;
}

/** ประกอบ public URL แบบเต็มจาก path สัมพัทธ์ (สำหรับ Flex image / QR) */
export function publicUrl(relativePath: string): string {
  return `${config.BASE_URL.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`;
}

export { UPLOAD_ROOT };
