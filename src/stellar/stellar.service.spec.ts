import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarService, PaymentResult } from './stellar.service';
import StellarSdk from 'stellar-sdk';

const mockServer = {
  loadAccount: jest.fn(),
  fetchBaseFee: jest.fn().mockResolvedValue(100),
  submitTransaction: jest.fn(),
  accounts: jest.fn(),
};

jest.spyOn(StellarSdk.Horizon.Server.prototype as any, 'constructor').mockImplementation(() => mockServer);

describe('StellarService', () => {
  let service: StellarService;

  const mockConfigService = {
    get: jest.fn((key: string, fallback?: string) => {
      const config: Record<string, string> = {
        STELLAR_NETWORK: 'testnet',
        STELLAR_TREASURY_SECRET_KEY: 'SCZANGBA5YHTNYVVV6C3FY4QBZ5SAF5CXTJ5E7BQYBN232LMEB6FKM5L',
      };
      return config[key] ?? fallback;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendPayment', () => {
    it('should submit a payment and return the transaction hash', async () => {
      const mockAccount = {
        sequenceNumber: () => '12345',
        accountId: () => 'GBXGQJWVL7YXGA24L5LJC5_ESR5II6V7QN2ERZLEKBZVFRVSSZB2D5R',
      };

      const mockTxResult = {
        hash: 'abc123_stellar_hash',
        result_xdr: 'AAAA...',
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.submitTransaction.mockResolvedValue(mockTxResult);

      const result = await service.sendPayment(
        'GDESTINATIONADDRESS1234567890123456789012345678901234567890',
        5.0,
      );

      expect(result.stellarTxHash).toBe('abc123_stellar_hash');
      expect(result.destination).toBe(
        'GDESTINATIONADDRESS1234567890123456789012345678901234567890',
      );
      expect(mockServer.loadAccount).toHaveBeenCalled();
      expect(mockServer.submitTransaction).toHaveBeenCalled();
    });

    it('should throw when STELLAR_TREASURY_SECRET_KEY is not configured', async () => {
      mockConfigService.get.mockImplementation((key: string, fallback?: string) => {
        if (key === 'STELLAR_TREASURY_SECRET_KEY') return undefined;
        return fallback;
      });

      await expect(
        service.sendPayment('GDESTINATION', 1.0),
      ).rejects.toThrow('STELLAR_TREASURY_SECRET_KEY is not configured');
    });

    it('should throw when Stellar network submission fails', async () => {
      const mockAccount = {
        sequenceNumber: () => '12345',
        accountId: () => 'GBXG',
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.submitTransaction.mockRejectedValue(new Error('tx failed'));

      await expect(
        service.sendPayment('GDESTINATION', 1.0),
      ).rejects.toThrow('tx failed');
    });
  });

  describe('accountExists', () => {
    it('should return true when account exists', async () => {
      mockServer.accounts.mockReturnValue({
        accountId: jest.fn().mockReturnValue({
          call: jest.fn().mockResolvedValue({ id: 'GA...' }),
        }),
      });

      const result = await service.accountExists('GA...');
      expect(result).toBe(true);
    });

    it('should return false when account does not exist', async () => {
      mockServer.accounts.mockReturnValue({
        accountId: jest.fn().mockReturnValue({
          call: jest.fn().mockRejectedValue(new Error('not found')),
        }),
      });

      const result = await service.accountExists('GA...');
      expect(result).toBe(false);
    });
  });

  describe('getAccountBalance', () => {
    it('should return native XLM balance', async () => {
      mockServer.accounts.mockReturnValue({
        accountId: jest.fn().mockReturnValue({
          call: jest.fn().mockResolvedValue({
            balances: [
              { asset_type: 'native', balance: '100.5000000' },
            ],
          }),
        }),
      });

      const result = await service.getAccountBalance('GA...');
      expect(result).toBe('100.5000000');
    });

    it('should throw when unable to fetch balance', async () => {
      mockServer.accounts.mockReturnValue({
        accountId: jest.fn().mockReturnValue({
          call: jest.fn().mockRejectedValue(new Error('network error')),
        }),
      });

      await expect(service.getAccountBalance('GA...')).rejects.toThrow(
        'Unable to fetch account balance',
      );
    });
  });
});
