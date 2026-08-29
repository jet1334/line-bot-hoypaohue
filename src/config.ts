import 'dotenv/config';
import { z } from 'zod';

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

export const config = parsed.data;
