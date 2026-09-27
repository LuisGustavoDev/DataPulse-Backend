import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { newId } from '../common/uuid';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { PG_POOL } from '../infra/infra.module';
import type { AccessTokenClaims, LoginBody, SignupBody } from './auth.schemas';
import { hashPassword, verifyPassword } from './password';
import { generateRefreshToken, hashRefreshToken } from './refresh-token';
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

/** O que o service devolve ao controller: o corpo da resposta e o refresh token, que vai no cookie. */
export type Session = { body: AuthResult; refreshToken: string };

/** Erro do PostgreSQL para "valor duplicado numa coluna única". */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505' &&
    (err as { constraint?: string }).constraint === constraint
  );
}

const refreshInvalid = () =>
  new UnauthorizedException({ code: 'REFRESH_INVALID', message: 'Sessão inválida ou expirada; faça login de novo' });

@Injectable()
export class AuthService {
  /**
   * Hash de uma senha aleatória, usado quando o e-mail não existe. Assim o login
   * demora o mesmo tempo com e sem usuário, e o tempo de resposta não revela
   * quais e-mails estão cadastrados.
   */
  private readonly dummyHash = hashPassword(randomUUID());

  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tokens: TokensService,
  ) {}

  get refreshTokenTtlMs(): number {
    return this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  async signup(body: SignupBody): Promise<Session> {
    const passwordHash = await hashPassword(body.password);
    const tenantId = newId();
    const userId = newId();

    // Empresa, usuário e sessão nascem juntos: se um falhar, nenhum fica gravado
    return this.transaction(async (client) => {
      try {
        await client.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, body.company_name]);
        await client.query(
          `INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4, 'admin')`,
          [userId, tenantId, body.email, passwordHash],
        );
      } catch (err) {
        if (isUniqueViolation(err, 'users_email_key')) {
          throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Este e-mail já está cadastrado' });
        }
        throw err;
      }
      const user = { id: userId, email: body.email, role: 'admin' as const, tenant_id: tenantId, tenant_name: body.company_name };
      return this.startSession(client, user, newId());
    });
  }

  async login(body: LoginBody): Promise<Session> {
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

    return this.transaction(async (client) => {
      await client.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      // Cada login abre uma família nova de refresh tokens
      return this.startSession(client, user, newId());
    });
  }

  /**
   * Troca um refresh token válido por um novo par (rotação, spec §11.2).
   * Se um token já trocado aparecer de novo, alguém o copiou: a família inteira é revogada.
   */
  async refresh(refreshToken: string | undefined): Promise<Session> {
    if (!refreshToken) throw refreshInvalid();

    let reuseDetected = false;
    const session = await this.transaction(async (client) => {
      // FOR UPDATE trava a linha: dois refresh simultâneos com o mesmo token não passam os dois
      const { rows } = await client.query<
        UserWithTenant & { token_id: string; family_id: string; expires_at: Date; revoked_at: Date | null; status: string; tenant_status: string }
      >(
        `SELECT rt.id AS token_id, rt.family_id, rt.expires_at, rt.revoked_at,
                u.id, u.email, u.role, u.status, t.id AS tenant_id, t.name AS tenant_name, t.status AS tenant_status
           FROM refresh_tokens rt
           JOIN users u ON u.id = rt.user_id
           JOIN tenants t ON t.id = u.tenant_id
          WHERE rt.token_hash = $1
          FOR UPDATE OF rt`,
        [hashRefreshToken(refreshToken)],
      );
      const row = rows[0];
      if (!row) return null;

      if (row.revoked_at) {
        // Reuso: revoga todos os tokens da família. O COMMIT acontece antes do erro.
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
        reuseDetected = true;
        return null;
      }
      if (row.expires_at.getTime() <= Date.now() || row.status !== 'active' || row.tenant_status !== 'active') {
        return null;
      }

      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.token_id]);
      return this.startSession(client, row, row.family_id);
    });

    if (!session) {
      if (reuseDetected) {
        // Fica registrado no log: é um sinal de token roubado
        this.logger.warn('refresh token reutilizado; a sessão inteira foi revogada');
      }
      throw refreshInvalid();
    }
    return session;
  }

  /** Encerra a sessão: revoga todos os tokens da família do token atual. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE revoked_at IS NULL
          AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
      [hashRefreshToken(refreshToken)],
    );
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

  /** Grava um refresh token novo na família e emite o token de acesso. */
  private async startSession(client: PoolClient, user: UserWithTenant, familyId: string): Promise<Session> {
    const refreshToken = generateRefreshToken();
    await client.query(
      `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [newId(), user.id, familyId, hashRefreshToken(refreshToken), this.config.REFRESH_TOKEN_TTL_DAYS],
    );
    const accessToken = await this.tokens.signAccessToken({ sub: user.id, tid: user.tenant_id, role: user.role });
    return {
      refreshToken,
      body: {
        user: { id: user.id, email: user.email, role: user.role },
        tenant: { id: user.tenant_id, name: user.tenant_name },
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: this.tokens.accessTokenTtlSeconds,
      },
    };
  }

  /** Roda `fn` numa transação: COMMIT se terminar, ROLLBACK se lançar erro. */
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}