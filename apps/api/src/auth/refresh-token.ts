import { createHash, randomBytes } from 'node:crypto';

/** Nome do cookie que guarda o refresh token (spec §8.1). */
export const REFRESH_COOKIE = 'dp_rt';

/** O cookie só é enviado para as rotas de autenticação, nunca para o resto da API. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Gera um refresh token: 32 bytes aleatórios (256 bits), impossível de adivinhar.
 * É um valor opaco, não um JWT: só tem significado para o nosso banco.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * O banco guarda só o SHA-256 do token. Se a tabela vazar, os hashes não servem
 * para entrar. SHA-256 basta aqui (e não argon2) porque o token já é aleatório e longo.
 */
export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}