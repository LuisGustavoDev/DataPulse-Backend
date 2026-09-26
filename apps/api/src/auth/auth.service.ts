import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { newId } from '../common/uuid';
import { PG_POOL } from '../infra/infra.module';
import type { AccessTokenClaims, LoginBody, SignupBody } from './auth.schemas';
import { hashPassword, verifyPassword } from './password';
import { TokensService } from './tokens.service';

type Role = AccessTokenClaims['role'];

type UserWithTenant = {
  id: string;
  email: string;
  role: Role;
  tenant_id: string;
  tenant_name: string;
};

export type AuthResult = {
  user: { id: string; email: string; role: Role };
  tenant: { id: string; name: string };
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
};

/** Erro do PostgreSQL para "valor duplicado numa coluna única". */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505' &&
    (err as { constraint?: string }).constraint === constraint
  );
}

@Injectable()
export class AuthService {
  /**
   * Hash de uma senha aleatória, usado quando o e-mail não existe. Assim o login
   * demora o mesmo tempo com e sem usuário, e o tempo de resposta não revela
   * quais e-mails estão cadastrados.
   */
  private readonly dummyHash = hashPassword(randomUUID());

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tokens: TokensService,
  ) {}

  async signup(body: SignupBody): Promise<AuthResult> {
    const passwordHash = await hashPassword(body.password);
    const tenantId = newId();
    const userId = newId();

    // Empresa e usuário nascem juntos: se um falhar, nenhum dos dois fica gravado
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, body.company_name]);
      await client.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4, 'admin')`,
        [userId, tenantId, body.email, passwordHash],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(err, 'users_email_key')) {
        throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Este e-mail já está cadastrado' });
      }
      throw err;
    } finally {
      client.release();
    }

    return this.issue({
      id: userId,
      email: body.email,
      role: 'admin',
      tenant_id: tenantId,
      tenant_name: body.company_name,
    });
  }

  async login(body: LoginBody): Promise<AuthResult> {
    const { rows } = await this.pool.query<
      UserWithTenant & { password_hash: string; status: string; tenant_status: string }
    >(
      `SELECT u.id, u.email, u.role, u.password_hash, u.status,
              t.id AS tenant_id, t.name AS tenant_name, t.status AS tenant_status
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
        WHERE u.email = $1`,
      [body.email],
    );
    const user = rows[0];

    const passwordOk = await verifyPassword(user?.password_hash ?? (await this.dummyHash), body.password);
    if (!user || !passwordOk) {
      // Mesma mensagem para e-mail inexistente e senha errada (spec §8.2)
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos' });
    }
    if (user.status !== 'active' || user.tenant_status !== 'active') {
      throw new HttpException({ code: 'USER_DISABLED', message: 'Acesso desativado' }, HttpStatus.LOCKED);
    }

    await this.pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    return this.issue(user);
  }

  /** Dados do usuário logado, lidos do banco (o token pode estar desatualizado). */
  async me(claims: AccessTokenClaims): Promise<Pick<AuthResult, 'user' | 'tenant'>> {
    const { rows } = await this.pool.query<UserWithTenant>(
      `SELECT u.id, u.email, u.role, t.id AS tenant_id, t.name AS tenant_name
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1 AND u.tenant_id = $2`,
      [claims.sub, claims.tid],
    );
    const user = rows[0];
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuário não encontrado' });
    return { user: { id: user.id, email: user.email, role: user.role }, tenant: { id: user.tenant_id, name: user.tenant_name } };
  }

  private async issue(user: UserWithTenant): Promise<AuthResult> {
    const accessToken = await this.tokens.signAccessToken({ sub: user.id, tid: user.tenant_id, role: user.role });
    return {
      user: { id: user.id, email: user.email, role: user.role },
      tenant: { id: user.tenant_id, name: user.tenant_name },
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.tokens.accessTokenTtlSeconds,
    };
  }
}