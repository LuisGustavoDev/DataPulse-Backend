import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { ConfigModule } from './config/config.module';

@Module({
    imports: [ConfigModule],
    controllers: [HealthController],
})
export class AppModule {}