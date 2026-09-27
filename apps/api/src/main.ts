import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AppConfig } from './config/config';
import { APP_CONFIG } from './config/config.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  // Em dev, lê o .env da raiz. Em produção as variáveis já vêm do ambiente.
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // Sem .env: segue com o que estiver em process.env.
  }

  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  app.use(cookieParser()); // preenche req.cookies, onde chega o refresh token

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  await app.listen(config.API_PORT);
}

void bootstrap();