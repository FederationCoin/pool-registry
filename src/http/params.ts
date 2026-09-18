import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ChainId } from '../domain/constants';
import type { SigningEnvelope } from '../domain/types';

export const Chain = createParamDecorator((_d: unknown, ctx: ExecutionContext): ChainId => {
  return (ctx.switchToHttp().getRequest<Request>() as Request & { chain: ChainId }).chain;
});

export const Envelope = createParamDecorator((_d: unknown, ctx: ExecutionContext): SigningEnvelope => {
  return (ctx.switchToHttp().getRequest<Request>() as Request & { envelope: SigningEnvelope }).envelope;
});

export const Wallet = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  return (ctx.switchToHttp().getRequest<Request>() as Request & { envelope: SigningEnvelope }).envelope.wallet;
});

export const ClientIp = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? '1');
  const xff = req.header('x-forwarded-for');
  if (xff && hops > 0) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    return parts[Math.max(0, parts.length - hops)] ?? req.ip ?? '0.0.0.0';
  }
  return req.ip ?? '0.0.0.0';
});
