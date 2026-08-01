import { createHash, randomBytes } from 'node:crypto';

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}
