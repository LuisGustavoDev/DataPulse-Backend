import { z } from 'zod';

/** Variáveis de ambiente que a API precisa. Qualquer uma faltando impede o app de subir. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET_INCOMING: z.string().min(1),
  S3_BUCKET_ARCHIVE: z.string().min(1),

    // Chaves RSA em PEM codificado em base64 (geradas por "pnpm keys:generate")
  JWT_PRIVATE_KEY: z.base64().min(1),
  JWT_PUBLIC_KEY: z.base64().min(1),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900), // 15 min
});

export type AppConfig = z.infer<typeof EnvSchema>;

/** Valida as variáveis e devolve a config tipada. Lança erro listando tudo que está errado. */
export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${problems}`);
  }
  return result.data;
}