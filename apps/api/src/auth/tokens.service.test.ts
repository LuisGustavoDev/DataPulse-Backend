import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/config';
import { TokensService } from './tokens.service';

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return {
    JWT_PRIVATE_KEY: Buffer.from(privateKey).toString('base64'),
    JWT_PUBLIC_KEY: Buffer.from(publicKey).toString('base64'),
  };
}

async function createService(keys: ReturnType<typeof keyPair>): Promise<TokensService> {
  const service = new TokensService({ ...keys, JWT_ACCESS_TTL_SECONDS: 900 } as AppConfig);
  await service.onModuleInit();
  return service;
}

const claims = {
  sub: '0192ef10-0000-7000-8000-000000000002',
  tid: '0192ef10-0000-7000-8000-000000000001',
  role: 'admin' as const,
};

describe('TokensService', () => {
  let service: TokensService;
  beforeAll(async () => {
    service = await createService(keyPair());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emite um token e lê de volta os mesmos dados', async () => {
    const token = await service.signAccessToken(claims);
    expect(await service.verifyAccessToken(token)).toEqual(claims);
  });

  it('recusa um token adulterado', async () => {
    const [header, payload, signature] = (await service.signAccessToken(claims)).split('.');
    const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    forged.role = 'admin';
    forged.tid = '0192ef10-0000-7000-8000-000000000099'; // tenta trocar de empresa
    const tampered = [header, Buffer.from(JSON.stringify(forged)).toString('base64url'), signature].join('.');
    await expect(service.verifyAccessToken(tampered)).rejects.toThrow();
  });

  it('recusa um token assinado por outra chave', async () => {
    const other = await createService(keyPair());
    await expect(service.verifyAccessToken(await other.signAccessToken(claims))).rejects.toThrow();
  });

  it('recusa um token expirado', async () => {
    vi.useFakeTimers();
    const token = await service.signAccessToken(claims);
    vi.setSystemTime(Date.now() + 16 * 60 * 1000); // 16 minutos depois
    await expect(service.verifyAccessToken(token)).rejects.toThrow(/exp/);
  });
});