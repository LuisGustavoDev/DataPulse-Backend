import { argon2id, hash, verify } from 'argon2';

// Parâmetros da spec §11.2: argon2id, 64 MiB de memória, 3 passadas, 1 thread.
// A memória alta é o que torna caro testar bilhões de senhas num banco roubado.
const OPTIONS = { type: argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}