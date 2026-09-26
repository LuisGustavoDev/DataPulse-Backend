import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check() {
    const report = await this.health.check();
    if (report.status !== 'ok') {
      // 503: o load balancer e o orquestrador entendem que a API não está pronta
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}