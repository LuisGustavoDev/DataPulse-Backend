import { z } from 'zod';

/** POST /api/v1/auth/signup: cria a empresa e o primeiro usuário, como admin. */
export const SignupBody = z.object({
  company_name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  password: z.string().min(12, 'A senha precisa ter pelo menos 12 caracteres').max(128),
});
export type SignupBody = z.infer<typeof SignupBody>;

/** POST /api/v1/auth/login */
export const LoginBody = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});
export type LoginBody = z.infer<typeof LoginBody>;

/** O que vai dentro do token de acesso. */
export const AccessTokenClaims = z.object({
  sub: z.uuid(), // id do usuário
  tid: z.uuid(), // id do tenant (empresa)
  role: z.enum(['admin', 'analyst']),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;