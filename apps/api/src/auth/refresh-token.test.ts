import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken } from './refresh-token';

describe('refresh token', () => {
  it('gera tokens diferentes a cada chamada, com 256 bits', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
  });

  it('o hash tem 32 bytes e é sempre o mesmo para o mesmo token', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toHaveLength(32);
    expect(hashRefreshToken(token).equals(hashRefreshToken(token))).toBe(true);
  });

  it('o hash não contém o token', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token).toString('base64url')).not.toBe(token);
  });
});