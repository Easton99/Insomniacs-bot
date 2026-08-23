import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }]
      : [{ level: 'error', emit: 'event' }],
});

prisma.$on('warn', (e) => {
  logger.warn({ msg: e.message }, 'Prisma warning');
});

prisma.$on('error', (e) => {
  logger.error({ msg: e.message }, 'Prisma error');
});

export const db = prisma;

export async function connectDatabase(): Promise<void> {
  await db.$connect();
  logger.info('Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await db.$disconnect();
  logger.info('Database disconnected');
}
