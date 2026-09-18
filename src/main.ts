import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { json, type Request } from 'express';
import { AppModule } from './app.module';
import { ProblemFilter } from './http/problem.filter';
import { EnvelopeBodyCapBytes, CommandBodyCapBytes, TokenSettings } from './domain/constants';
import type { RegistrySettings } from './ports/secret-store';
import { Logger, ValidationPipe } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });
  const settings = app.get<RegistrySettings>(TokenSettings);
  app.use(helmet());
  app.use(json({ limit: EnvelopeBodyCapBytes + CommandBodyCapBytes }));
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ProblemFilter());
  app.enableCors({
    origin: settings.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'X-FederationCoin-Chain', 'Content-Type'],
    credentials: false,
  });
  process.env.TRUSTED_PROXY_HOPS = String(settings.trustedProxyHops);
  const log = new Logger('bootstrap');
  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
  log.log(`listening on ${port}`);
}

void bootstrap();
