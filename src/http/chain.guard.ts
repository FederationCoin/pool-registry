import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { LiveTenants, type ChainId } from '../domain/constants';
import { RegistryProblem } from '../domain/types';

@Injectable()
export class ChainHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.header('x-federationcoin-chain');
    if (!raw) {
      throw new RegistryProblem(400, 'missingChain', 'X-FederationCoin-Chain is required');
    }
    if (raw !== 'testnet' && raw !== 'main') {
      throw new RegistryProblem(400, 'unknownChain', 'X-FederationCoin-Chain is unknown');
    }
    if (!(LiveTenants as readonly string[]).includes(raw)) {
      throw new RegistryProblem(400, 'unknownChain', 'This chain is not a live tenant');
    }
    (req as Request & { chain: ChainId }).chain = raw;
    return true;
  }
}
