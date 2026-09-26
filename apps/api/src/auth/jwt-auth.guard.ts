import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AccessTokenClaims } from './auth.schemas';
import { TokensService } from './tokens.service';

export type AuthenticatedRequest = {
  headers: Record<string, string | string[] | undefined>;
  user?: AccessTokenClaims;
};

/** Protege uma rota: só passa quem manda "Authorization: Bearer <token válido>". */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokensService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['authorization'];
    const [scheme, token] = typeof header === 'string' ? header.split(' ') : [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Token de acesso ausente' });
    }
    try {
      request.user = await this.tokens.verifyAccessToken(token);
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Token de acesso inválido ou expirado' });
    }
  }
}