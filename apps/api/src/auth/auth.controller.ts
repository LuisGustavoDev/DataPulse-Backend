import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AccessTokenClaims, LoginBody, SignupBody } from './auth.schemas';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/signup')
  @HttpCode(HttpStatus.CREATED)
  signup(@Body(new ZodValidationPipe(SignupBody)) body: SignupBody) {
    return this.auth.signup(body);
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(LoginBody)) body: LoginBody) {
    return this.auth.login(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AccessTokenClaims) {
    return this.auth.me(user);
  }
}