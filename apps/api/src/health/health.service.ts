import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { PG_POOL, REDIS, S3 } from '../infra/infra.module';

export type CheckResult = { status: 'up' | 'down'; latency_ms: number; error?: string };

export type HealthReport = {
  status: 'ok' | 'degraded';
  checks: Record<'postgres' | 'redis' | 'storage', CheckResult>;
};

/** Tempo máximo de cada verificação. Um serviço travado não pode travar o health check. */
export const CHECK_TIMEOUT_MS = 2_000;

/**
 * Extrai uma mensagem útil do erro. Conexão recusada em `localhost` chega como
 * AggregateError (uma falha por IPv4 e outra por IPv6), com `message` vazia.
 */
export function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) return describeError(err.errors[0]);
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return err.message || code || err.name;
  }
  return String(err);
}

/** Roda `fn` com limite de tempo e mede quanto demorou. Nunca lança erro. */
export async function probe(fn: () => Promise<unknown>, timeoutMs = CHECK_TIMEOUT_MS): Promise<CheckResult> {
  const start = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout de ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([fn(), timeout]);
    return { status: 'up', latency_ms: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      status: 'down',
      latency_ms: Math.round(performance.now() - start),
      error: describeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  async check(): Promise<HealthReport> {
    const [postgres, redis, storage] = await Promise.all([
      probe(() => this.pool.query('SELECT 1')),
      probe(() => {
        // Sem fila offline, um comando com a conexão caída falharia com uma mensagem confusa
        if (this.redis.status !== 'ready') throw new Error(`conexão ${this.redis.status}`);
        return this.redis.ping();
      }),
      probe(() =>
        Promise.all(
          [this.config.S3_BUCKET_INCOMING, this.config.S3_BUCKET_ARCHIVE].map((bucket) =>
            this.s3.send(new HeadBucketCommand({ Bucket: bucket })),
          ),
        ),
      ),
    ]);
    const checks = { postgres, redis, storage };
    const allUp = Object.values(checks).every((c) => c.status === 'up');
    return { status: allUp ? 'ok' : 'degraded', checks };
  }
}