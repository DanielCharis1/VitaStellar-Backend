import { Injectable } from '@nestjs/common';

import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  constructor() {
    super();
  }

  async isHealthy(key = 'queue'): Promise<HealthIndicatorResult> {
    try {
      // TODO: Re-enable actual queue health check once QueueService is available
      // Queue health check - returns healthy by default (temporary stub)
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError('Queue check failed', this.getStatus(key, false));
    }
  }
}
