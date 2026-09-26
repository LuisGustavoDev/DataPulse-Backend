import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccessTokenClaims } from './auth.schemas';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/** Entrega no parâmetro do método os dados do usuário logado (preenchidos pelo JwtAuthGuard). */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user as AccessTokenClaims;
});