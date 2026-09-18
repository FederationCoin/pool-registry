import { describe, expect, it } from 'vitest';
import { assertListingNameAllowed, assertReviewTextAllowed } from './text';
import { RegistryProblem } from './types';
import { jcs } from './jcs';

describe('text and jcs', () => {
  it('rejects empty and flagged names', () => {
    expect(() => assertListingNameAllowed('')).toThrow(RegistryProblem);
    expect(() => assertListingNameAllowed('x'.repeat(65))).toThrow(RegistryProblem);
    expect(() => assertReviewTextAllowed('you retard')).toThrow(RegistryProblem);
    expect(() => assertListingNameAllowed('Fine Pool')).not.toThrow();
  });

  it('canonicalizes objects', () => {
    expect(jcs({ b: 1, a: 2 })).toBe(jcs({ a: 2, b: 1 }));
  });
});
