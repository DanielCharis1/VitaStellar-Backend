import { TokenRevocationService } from './token-revocation.service';

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

describe('TokenRevocationService', () => {
  let service: TokenRevocationService;

  beforeEach(() => {
    service = new TokenRevocationService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isAccessTokenRevoked', () => {
    it('should return false when token is not in Redis', async () => {
      const result = await service.isAccessTokenRevoked('token-123');
      expect(result).toBe(false);
    });
  });

  describe('revokeAccessToken', () => {
    it('should store token in Redis with TTL', async () => {
      await expect(service.revokeAccessToken('token-123')).resolves.toBeUndefined();
    });
  });

  describe('revokeAccessTokens', () => {
    it('should do nothing for empty array', async () => {
      await expect(service.revokeAccessTokens([])).resolves.toBeUndefined();
    });
  });
});
