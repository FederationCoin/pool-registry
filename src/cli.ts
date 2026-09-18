import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TokenAdminOverlay } from './domain/constants';
import type { AdminOverlay } from './ports/admin-overlay';

async function main(): Promise<void> {
  const [, , cmd, reviewer, poolId, ...rest] = process.argv;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const admin = app.get<AdminOverlay>(TokenAdminOverlay);
  try {
    if (cmd === 'set-hostile-flag') {
      await admin.setHostileFlag(reviewer, poolId, rest.join(' '));
      return;
    }
    if (cmd === 'withdraw-hostile-flag') {
      await admin.withdrawHostileFlag(reviewer, poolId, rest.join(' '));
      return;
    }
    console.error('usage: registry-admin set-hostile-flag|withdraw-hostile-flag <wallet> <poolId> <note>');
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
