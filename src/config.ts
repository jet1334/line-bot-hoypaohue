import 'dotenv/config';
import { z } from 'zod';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const schema = z.object({
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  LINE_CHANNEL_SECRET: z.string().min(1),
  LIFF_ID: z.string().min(1),
  BASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REMINDER_CRON: z.string().default('0 9 * * *'),
  TZ: z.string().default('Asia/Bangkok'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

function getBuildVersion(): string {
  if (process.env.BUILD_VERSION) return process.env.BUILD_VERSION;
  try {
    const versionFile = path.resolve('public/version.json');
    if (fs.existsSync(versionFile)) {
      const data = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
      if (data && data.version) return String(data.version);
    }
  } catch {}
  try {
    const gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (gitHash) return gitHash;
  } catch {}
  return '0.1.0';
}

export const config = {
  ...parsed.data,
  BUILD_VERSION: getBuildVersion(),
};
