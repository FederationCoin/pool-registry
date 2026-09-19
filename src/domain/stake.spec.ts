import { describe, expect, it } from 'vitest';
import {
  compactToTarget,
  evaluateStake,
  jsonRpcCoinsToSats,
  stakeMineSeconds,
  stakeRequiredSats,
  tipWindow,
} from './stake';
import { LaunchTipWindow, SteadyTipWindow } from './constants';

describe('stake', () => {
  it('computes a positive stake from compact nBits', () => {
    const sats = stakeRequiredSats(0x1d00ffff, 50n * 100_000_000n, 3600);
    expect(sats > 0n).toBe(true);
  });

  it('makes a day of work 24 times one hour at the same nBits', () => {
    const nBits = 0x1d00ffff;
    const subsidy = 50n * 100_000_000n;
    const hour = stakeRequiredSats(nBits, subsidy, stakeMineSeconds('testnet'));
    const day = stakeRequiredSats(nBits, subsidy, stakeMineSeconds('main'));
    expect(stakeMineSeconds('testnet')).toBe(3600);
    expect(stakeMineSeconds('main')).toBe(86400);
    expect(day / hour).toBe(24n);
  });

  it('uses launch window before a retarget', () => {
    expect(tipWindow({ height: 10 })).toBe(LaunchTipWindow);
    expect(tipWindow({ height: 3000, lastRetargetMedianSpacingSeconds: 600 })).toBe(SteadyTipWindow);
  });

  it('open season needs balance only', () => {
    const r = evaluateStake({ liveCount: 1, balanceSats: 10n, requiredSats: 5n, holdOk: false });
    expect(r.preview.kind).toBe('stakeReady');
    expect(r.check.kind).toBe('openSeason');
  });

  it('seasoned needs hold', () => {
    const waiting = evaluateStake({ liveCount: 100, balanceSats: 10n, requiredSats: 5n, holdOk: false });
    expect(waiting.preview.kind).toBe('stakeWaiting');
    const ready = evaluateStake({ liveCount: 100, balanceSats: 10n, requiredSats: 5n, holdOk: true });
    expect(ready.preview.kind).toBe('stakeReady');
  });

  it('parses compact target', () => {
    expect(compactToTarget(0x1d00ffff) > 0n).toBe(true);
  });

  it('converts bitcoind coin amounts to sats', () => {
    expect(jsonRpcCoinsToSats(12.34)).toBe(1_234_000_000n);
    expect(jsonRpcCoinsToSats('2993.40552346')).toBe(299_340_552_346n);
    expect(jsonRpcCoinsToSats('0.00000001')).toBe(1n);
    expect(jsonRpcCoinsToSats('not-a-number')).toBe(0n);
  });
});
