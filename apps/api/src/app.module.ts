import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [ConfigModule, InfraModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}