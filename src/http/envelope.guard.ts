import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { EnvelopeBodyCapBytes } from '../domain/constants';
import { RegistryProblem, type SigningEnvelope } from '../domain/types';

@Injectable()
export class SigningEnvelopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header('authorization') ?? '';
    const m = /^Bearer\s+(\S+)/i.exec(header);
    if (!m) {
      throw new RegistryProblem(401, 'badEnvelope', 'Authorization Bearer is required');
    }
    let json: string;
    try {
      json = Buffer.from(m[1], 'base64url').toString('utf8');
    } catch {
      throw new RegistryProblem(401, 'badEnvelope', 'Authorization Bearer is required');
    }
    if (Buffer.byteLength(json, 'utf8') > EnvelopeBodyCapBytes) {
      throw new RegistryProblem(400, 'badEnvelope', 'Envelope is too large');
    }
    let env: SigningEnvelope;
    try {
      env = JSON.parse(json) as SigningEnvelope;
    } catch {
      throw new RegistryProblem(400, 'badEnvelope', 'Envelope is not JSON');
    }
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      throw new RegistryProblem(400, 'badEnvelope', 'Envelope is not JSON');
    }
    (req as Request & { envelope: SigningEnvelope }).envelope = env;
    return true;
  }
}
