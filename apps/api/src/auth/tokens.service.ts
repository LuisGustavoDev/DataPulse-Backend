import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { AccessTokenClaims } from './auth.schemas';

const ALGORITHM = 'RS256';
const ISSUER = 'datapulse';
const AUDIENCE = 'datapulse-api';

type Key = Awaited<ReturnType<typeof importPKCS8>>;

/** Emite e confere os tokens de acesso (JWT). */
@Injectable()
export class TokensService implements OnModuleInit {
  private privateKey!: Key;
  private publicKey!: Key;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Converte as chaves do .env uma vez, na subida. Chave inválida impede o app de subir. */
  async onModuleInit(): Promise<void> {
    const pem = (base64: string) => Buffer.from(base64, 'base64').toString('utf8');
    this.privateKey = await importPKCS8(pem(this.config.JWT_PRIVATE_KEY), ALGORITHM);
    this.publicKey = await importSPKI(pem(this.config.JWT_PUBLIC_KEY), ALGORITHM);
  }

  get accessTokenTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL_SECONDS;
  }

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ tid: claims.tid, role: claims.role })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.privateKey);
  }

  /** Lança erro se o token for inválido, adulterado, expirado ou de outro emissor. */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return AccessTokenClaims.parse({ sub: payload.sub, tid: payload['tid'], role: payload['role'] });
  }
}