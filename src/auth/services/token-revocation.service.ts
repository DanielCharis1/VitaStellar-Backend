import { Injectable, Logger } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

const REVOKED_ACCESS_PREFIX = 'revoked_access:';
const ACCESS_TOKEN_TTL_SECONDS = 900; // 15 minutes

@Injectable()
export class TokenRevocationService {
  private readonly logger = new Logger(TokenRevocationService.name);
  private readonly redisClient: RedisClientType;

  constructor() {
    this.redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    this.redisClient.connect();
  }

  async revokeAccessToken(tokenId: string): Promise<void> {
    try {
      await this.redisClient.set(
        `${REVOKED_ACCESS_PREFIX}${tokenId}`,
        '1',
        { EX: ACCESS_TOKEN_TTL_SECONDS },
      );
    } catch (err: any) {
      this.logger.warn(`Failed to revoke access token in Redis: ${err.message}`);
    }
  }

  async revokeAccessTokens(tokenIds: string[]): Promise<void> {
    if (tokenIds.length === 0) return;
    try {
      const pipeline = this.redisClient.multi();
      for (const id of tokenIds) {
        pipeline.set(`${REVOKED_ACCESS_PREFIX}${id}`, '1', { EX: ACCESS_TOKEN_TTL_SECONDS });
      }
      await pipeline.exec();
    } catch (err: any) {
      this.logger.warn(`Failed to revoke access tokens in Redis: ${err.message}`);
    }
  }

  async isAccessTokenRevoked(tokenId: string): Promise<boolean> {
    try {
      const value = await this.redisClient.get(`${REVOKED_ACCESS_PREFIX}${tokenId}`);
      return value !== null;
    } catch (err: any) {
      this.logger.warn(`Failed to check access token revocation: ${err.message}`);
      return false;
    }
  }
}
