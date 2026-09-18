import { describe, expect, it } from 'vitest';
import { compactToTarget, evaluateStake, stakeRequiredSats, tipWindow } from './stake';
import { LaunchTipWindow, SteadyTipWindow } from './constants';

describe('stake', () => {
  it('computes a positive stake from compact nBits', () => {
    const sats = stakeRequiredSats(0x1d00ffff, 50n * 100_000_000n);
    expect(sats > 0n).toBe(true);
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
});
