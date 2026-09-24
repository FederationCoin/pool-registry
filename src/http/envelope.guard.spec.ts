import { describe, expect, it } from 'vitest';
import { EnvelopeBodyCapBytes } from '../domain/constants';
import { tryWalletFromAuthorization } from './envelope.guard';

describe('tryWalletFromAuthorization', () => {
  it('ignores missing and junk Bearer so GET stays public', () => {
    expect(tryWalletFromAuthorization(undefined)).toBeUndefined();
    expect(tryWalletFromAuthorization('')).toBeUndefined();
    expect(tryWalletFromAuthorization('Bearer not-base64url!!!')).toBeUndefined();
    const json = Buffer.from(JSON.stringify({ wallet: 'tgfcn1qqqq' }), 'utf8').toString('base64url');
    expect(tryWalletFromAuthorization(`Bearer ${json}`)).toBeUndefined();
    const huge = Buffer.from('a'.repeat(EnvelopeBodyCapBytes + 8), 'utf8').toString('base64url');
    expect(tryWalletFromAuthorization(`Bearer ${huge}`)).toBeUndefined();
  });
});
