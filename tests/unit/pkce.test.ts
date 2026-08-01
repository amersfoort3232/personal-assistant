import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPkcePair } from '../../src/main/google/pkce';

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

describe('PKCE', () => {
  it('creates a URL-safe verifier and its SHA-256 challenge', () => {
    const pair = createPkcePair();

    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.challenge).toBe(base64Url(createHash('sha256').update(pair.verifier).digest()));
    expect(pair.challenge).not.toBe(pair.verifier);
  });

  it('creates a fresh verifier for each authorization attempt', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});
