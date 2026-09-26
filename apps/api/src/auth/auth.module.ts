import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokensService } from './tokens.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokensService, JwtAuthGuard],
  // Outros módulos vão proteger rotas com o guard, que depende do TokensService
  exports: [TokensService, JwtAuthGuard],
})
export class AuthModule {}