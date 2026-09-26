import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

const valid = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
    S3_BUCKET_INCOMING: 'dp-incoming',
    S3_BUCKET_ARCHIVE: 'dp-archive',
    JWT_PRIVATE_KEY: 'cHJpdmF0ZQ==',
    JWT_PUBLIC_KEY: 'cHVibGlj',
};

describe('parseConfig', () => {
  it('aplica os valores padrão', () => {
    const config = parseConfig(valid);
    expect(config.API_PORT).toBe(3001);
    expect(config.NODE_ENV).toBe('development');
  });

  it('converte a porta de texto para número', () => {
    expect(parseConfig({ ...valid, API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('lista todas as variáveis com problema de uma vez', () => {
    const env: NodeJS.ProcessEnv = { ...valid, API_PORT: 'abc' };
    delete env.DATABASE_URL;
    expect(() => parseConfig(env)).toThrow(/DATABASE_URL[\s\S]*API_PORT|API_PORT[\s\S]*DATABASE_URL/);
  });

  it('recusa URL com protocolo errado', () => {
    expect(() => parseConfig({ ...valid, REDIS_URL: 'http://localhost:6379' })).toThrow(/REDIS_URL/);
  });
});