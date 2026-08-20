import { UnauthorizedException } from '@nestjs/common';
import { TokenRevocationService } from '../services/token-revocation.service';
import { JwtStrategy } from './jwt.strategy';

jest.mock('redis', () => ({
  createClient: () => ({
    connect: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    multi: () => ({
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
  }),
}));

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let tokenRevocationService: TokenRevocationService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    tokenRevocationService = new TokenRevocationService();
    strategy = new JwtStrategy(tokenRevocationService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('validate', () => {
    it('should return user claims when token is not revoked', async () => {
      jest.spyOn(tokenRevocationService, 'isAccessTokenRevoked').mockResolvedValue(false);

      const payload = {
        sub: 'user-1',
        email: 'test@example.com',
        role: 'user',
        tokenId: 'token-abc',
      };

      const result = await strategy.validate(payload);
      expect(result).toEqual({
        sub: 'user-1',
        email: 'test@example.com',
        role: 'user',
      });
    });

    it('should throw UnauthorizedException when access token is revoked', async () => {
      jest.spyOn(tokenRevocationService, 'isAccessTokenRevoked').mockResolvedValue(true);

      const payload = {
        sub: 'user-1',
        email: 'test@example.com',
        role: 'user',
        tokenId: 'token-revoked',
      };

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(payload)).rejects.toThrow('Access token has been revoked');
    });

    it('should allow tokens without tokenId (backward compatibility)', async () => {
      const payload = {
        sub: 'user-1',
        email: 'test@example.com',
        role: 'user',
      };

      const result = await strategy.validate(payload);
      expect(result).toEqual({
        sub: 'user-1',
        email: 'test@example.com',
        role: 'user',
      });
    });
  });
});
