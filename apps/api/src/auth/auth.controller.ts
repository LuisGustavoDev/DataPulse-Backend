import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AccessTokenClaims, LoginBody, SignupBody } from './auth.schemas';
import { AuthService, type Session } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './refresh-token';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body(new ZodValidationPipe(SignupBody)) body: SignupBody, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.signup(body));
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body(new ZodValidationPipe(LoginBody)) body: LoginBody, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(body));
  }

  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]));
    } catch (err) {
      // Cookie inválido não serve para nada: apaga do navegador
      res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      throw err;
    }
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AccessTokenClaims) {
    return this.auth.me(user);
  }

  /** Grava o refresh token no cookie e devolve só o corpo (sem o refresh token). */
  private respond(res: Response, session: Session) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true, // JavaScript da página não lê: protege contra XSS
      sameSite: 'strict', // outro site não consegue disparar requisições com ele: protege contra CSRF
      secure: process.env.NODE_ENV === 'production', // só HTTPS em produção
      path: REFRESH_COOKIE_PATH,
      maxAge: this.auth.refreshTokenTtlMs,
    });
    return session.body;
  }
}