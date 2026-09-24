import {
  DifficultyPeriodBlocks,
  HiddenAfterMs,
  LaunchTipWindow,
  OpenSeasonLiveCap,
  Rtx3090TiBlake2bHashesPerSecond,
  SpacingSlack,
  SteadyTipWindow,
  TargetSpacingSeconds,
  type ChainId,
} from './constants';
import { RegistryProblem, type StakeCheck, type StakePreviewResult } from './types';

export function compactToTarget(nBits: number): bigint {
  const exp = nBits >>> 24;
  const mant = nBits & 0x007fffff;
  if (exp <= 3) {
    return BigInt(mant) >> BigInt(8 * (3 - exp));
  }
  return BigInt(mant) << BigInt(8 * (exp - 3));
}

export function stakeMineSeconds(chain: ChainId): number {
  return chain === 'main' ? 86400 : 3600;
}

export function stakeRequiredSats(nBits: number, subsidySats: bigint, mineSeconds: number): bigint {
  const target = compactToTarget(nBits);
  const expected = (1n << 256n) / (target + 1n);
  const hashes = BigInt(Rtx3090TiBlake2bHashesPerSecond) * BigInt(mineSeconds);
  if (expected === 0n) {
    return subsidySats;
  }
  return (hashes * subsidySats) / expected;
}

const CoinSats = 100_000_000n;

/** bitcoind JSON-RPC amounts are coins (8 decimals), not sats. */
export function jsonRpcCoinsToSats(amount: unknown): bigint {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    return BigInt(Math.round(amount * 1e8));
  }
  if (typeof amount !== 'string' || !/^-?\d+(\.\d{1,8})?$/.test(amount)) {
    return 0n;
  }
  const neg = amount.startsWith('-');
  const raw = neg ? amount.slice(1) : amount;
  const [whole, frac = ''] = raw.split('.');
  const sats = BigInt(whole) * CoinSats + BigInt((frac + '00000000').slice(0, 8));
  return neg ? -sats : sats;
}

export function tipWindow(args: {
  height: number;
  lastRetargetMedianSpacingSeconds?: number;
}): number {
  if (args.height < DifficultyPeriodBlocks) {
    return LaunchTipWindow;
  }
  const spacing = args.lastRetargetMedianSpacingSeconds;
  if (
    spacing !== undefined &&
    Math.abs(spacing - TargetSpacingSeconds) / TargetSpacingSeconds <= SpacingSlack
  ) {
    return SteadyTipWindow;
  }
  return LaunchTipWindow;
}

export function assertTipWindow(
  signingHeight: number,
  tipHeight: number,
  window: number,
): void {
  if (signingHeight > tipHeight || tipHeight - signingHeight > window) {
    throw new RegistryProblem(400, 'tipWindow', 'Signing block is outside the tip window');
  }
}

export function chooseStakeKind(liveCount: number): 'openSeason' | 'seasoned' {
  return liveCount < OpenSeasonLiveCap ? 'openSeason' : 'seasoned';
}

export function evaluateStake(args: {
  liveCount: number;
  balanceSats: bigint;
  requiredSats: bigint;
  holdOk: boolean;
}): { preview: StakePreviewResult; check: StakeCheck } {
  const kind = chooseStakeKind(args.liveCount);
  const met = args.balanceSats >= args.requiredSats;
  if (kind === 'openSeason') {
    const check: StakeCheck = {
      kind: 'openSeason',
      metMinBalance: met,
      stakeRequiredSats: args.requiredSats.toString(),
    };
    return { preview: met ? { kind: 'stakeReady' } : { kind: 'stakeInsufficient' }, check };
  }
  const check: StakeCheck = {
    kind: 'seasoned',
    metMinBalance: met,
    stakeRequiredSats: args.requiredSats.toString(),
    holdOk: args.holdOk,
  };
  if (met && args.holdOk) {
    return { preview: { kind: 'stakeReady' }, check };
  }
  if (met && !args.holdOk) {
    return { preview: { kind: 'stakeWaiting', qualifiesAtHeight: 0 }, check };
  }
  return { preview: { kind: 'stakeInsufficient' }, check };
}

export function isLiveAt(createdAt: string, lastAttributedBlockAt: string | undefined, now: number): boolean {
  const attr = lastAttributedBlockAt ? Date.parse(lastAttributedBlockAt) : Date.parse(createdAt);
  return now - attr < HiddenAfterMs;
}

export function reapAfterMs(difficultyPeriodSeconds: number): number {
  return difficultyPeriodSeconds * 1000;
}
