// Confere se o ambiente de dev está pronto: PostgreSQL, Redis e storage S3.
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import pg from 'pg';

const env = process.env;

async function check(name: string, fn: () => Promise<string>): Promise<boolean> {
  const start = Date.now();
  try {
    const detail = await fn();
    console.log(`✔ ${name.padEnd(10)} ${detail} (${Date.now() - start} ms)`);
    return true;
  } catch (err) {
    console.log(`✘ ${name.padEnd(10)} ${(err as Error).message}`);
    return false;
  }
}

async function postgres(): Promise<string> {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query('SHOW server_version');
    return `versão ${rows[0].server_version}`;
  } finally {
    await client.end();
  }
}

async function redis(): Promise<string> {
  const client = new Redis(env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await client.connect();
  try {
    const [, policy] = (await client.config('GET', 'maxmemory-policy')) as string[];
    if (policy !== 'noeviction') throw new Error(`maxmemory-policy é ${policy}, esperado noeviction`);
    return `${await client.ping()}, maxmemory-policy=${policy}`;
  } finally {
    client.disconnect();
  }
}

async function storage(): Promise<string> {
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! },
  });
  try {
    for (const bucket of [env.S3_BUCKET_INCOMING!, env.S3_BUCKET_ARCHIVE!]) {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    }
    return `buckets ${env.S3_BUCKET_INCOMING} e ${env.S3_BUCKET_ARCHIVE} ok`;
  } finally {
    s3.destroy();
  }
}

const results = [
  await check('postgres', postgres),
  await check('redis', redis),
  await check('storage', storage),
];

if (results.every(Boolean)) {
  console.log('\nAmbiente pronto.');
} else {
  console.log('\nAlgo falhou. Rode "pnpm infra:ps" e veja se os containers estão de pé.');
  process.exit(1);
}
