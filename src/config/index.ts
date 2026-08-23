import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().min(1, 'DISCORD_GUILD_ID is required'),
  FACEIT_API_KEY: z.string().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  BOT_TIMEZONE: z.string().default('Europe/London'),
  CHEMISTRY_MIN_MATCHES: z.coerce.number().int().positive().default(10),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  // Logger is not yet initialised here — stderr is intentional
  process.stderr.write('Invalid configuration:\n');
  for (const [field, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    process.stderr.write(`  ${field}: ${errors?.join(', ') ?? 'unknown error'}\n`);
  }
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
