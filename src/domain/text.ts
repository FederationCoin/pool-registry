import { FLAG_WORDS } from './wordlist';
import { RegistryProblem } from './types';

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function assertCoinbaseTag(tag: string | undefined): string {
  if (!tag) {
    throw new RegistryProblem(400, 'unknownField', 'coinbaseTag is required');
  }
  const t = tag.trim();
  if (!t || t.length > 80) {
    throw new RegistryProblem(400, 'unknownField', 'coinbaseTag is invalid');
  }
  assertReviewTextAllowed(t);
  return t;
}

export function coinbaseHasDeclaredTag(observed: string | undefined, declared: string): boolean {
  if (!observed || !declared) {
    return false;
  }
  return observed.includes(declared);
}

export function assertListingNameAllowed(name: string): void {
  if (!name || name.length > 64) {
    throw new RegistryProblem(400, 'unknownField', 'name is invalid');
  }
  assertReviewTextAllowed(name);
}

export function assertReviewTextAllowed(text: string): void {
  if (text.length > 2000) {
    throw new RegistryProblem(400, 'unknownField', 'text is too long');
  }
  const lower = text.toLowerCase();
  for (const w of FLAG_WORDS) {
    if (lower.includes(w)) {
      throw new RegistryProblem(400, 'unknownField', 'text is not allowed');
    }
  }
}

export function censorTagForDisplay(tag: string): string {
  let out = tag;
  for (const w of FLAG_WORDS) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, '****');
  }
  return out;
}
