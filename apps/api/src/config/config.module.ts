import { Global, Module } from '@nestjs/common';
import { parseConfig } from './config';

/** Token de injeção da config. Uso: `@Inject(APP_CONFIG) config: AppConfig`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => parseConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}