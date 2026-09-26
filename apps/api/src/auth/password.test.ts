import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('senhas', () => {
  it('nunca guarda a senha original', async () => {
    const hash = await hashPassword('uma-senha-bem-longa');
    expect(hash).not.toContain('uma-senha-bem-longa');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('a mesma senha gera hashes diferentes (salt aleatório)', async () => {
    expect(await hashPassword('mesma-senha-123')).not.toBe(await hashPassword('mesma-senha-123'));
  });

  it('confere a senha certa e recusa a errada', async () => {
    const hash = await hashPassword('senha-correta-123');
    expect(await verifyPassword(hash, 'senha-correta-123')).toBe(true);
    expect(await verifyPassword(hash, 'senha-errada-1234')).toBe(false);
  });
});