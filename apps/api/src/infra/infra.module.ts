import { S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';

/** Tokens de injeção das conexões externas. */
export const PG_POOL = Symbol('PG_POOL');
export const REDIS = Symbol('REDIS');
export const S3 = Symbol('S3');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.DATABASE_URL, max: 10, connectionTimeoutMillis: 2_000 }),
    },
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false });
        const logger = new Logger('Redis');
        // Avisa só na primeira falha e na volta, em vez de a cada tentativa de reconexão
        let down = false;
        redis.on('error', (err: NodeJS.ErrnoException) => {
          if (!down) logger.warn(`sem conexão (${err.code ?? err.message}); tentando reconectar`);
          down = true;
        });
        redis.on('ready', () => {
          if (down) logger.log('reconectado');
          down = false;
        });
        return redis;
      },
    },
    {
      provide: S3,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new S3Client({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          forcePathStyle: true,
          credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
        }),
    },
  ],
  exports: [PG_POOL, REDIS, S3],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  /** Fecha as conexões ao desligar (Ctrl+C, docker stop). */
  async onApplicationShutdown(): Promise<void> {
    this.s3.destroy();
    this.redis.disconnect();
    await this.pool.end();
  }
}