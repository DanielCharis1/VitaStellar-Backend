import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { authenticator } from 'otplib';
import * as bcrypt from 'bcryptjs';
import { TwoFactorService } from './two-factor.service';
import { User } from '@/entities/user.entity';
import { TwoFactor } from '@/database/entities/two-factor.entity';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,qr'),
}));

describe('TwoFactorService', () => {
  let service: TwoFactorService;

  const mockUserRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockTwoFactorRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const baseUser = {
    id: 'user-1',
    email: 'test@example.com',
    twoFactorEnabled: false,
    twoFactorSecret: null,
  } as User;

  const baseRecord = {
    id: 'tf-1',
    userId: 'user-1',
    user: baseUser,
    secret: 'BASE32SECRET',
    enabled: false,
    backupCodes: [],
  } as TwoFactor;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(authenticator, 'generateSecret').mockReturnValue('GENERATED_SECRET');
    jest.spyOn(authenticator, 'keyuri').mockReturnValue('otpauth://totp/test');
    jest.spyOn(authenticator, 'check').mockReturnValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(TwoFactor), useValue: mockTwoFactorRepo },
      ],
    }).compile();

    service = module.get<TwoFactorService>(TwoFactorService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('confirmTwoFactor', () => {
    it('should enable 2FA and sync User.twoFactorEnabled + twoFactorSecret', async () => {
      mockTwoFactorRepo.findOne.mockResolvedValue({ ...baseRecord });
      mockTwoFactorRepo.save.mockImplementation(async (r) => r);
      mockUserRepo.findOne.mockResolvedValue({ ...baseUser });
      mockUserRepo.save.mockImplementation(async (u) => u);

      const result = await service.confirmTwoFactor('user-1', '123456');

      expect(result.message).toBe('Two-factor authentication enabled successfully');

      const savedUser = mockUserRepo.save.mock.calls[0][0];
      expect(savedUser.twoFactorEnabled).toBe(true);
      expect(savedUser.twoFactorSecret).toBe('GENERATED_SECRET');
    });

    it('should throw BadRequestException for invalid code', async () => {
      mockTwoFactorRepo.findOne.mockResolvedValue({ ...baseRecord });
      (authenticator.check as jest.Mock).mockReturnValue(false);

      await expect(service.confirmTwoFactor('user-1', '000000')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('disableTwoFactor', () => {
    it('should disable 2FA and clear User.twoFactorEnabled + twoFactorSecret', async () => {
      const enabledRecord = { ...baseRecord, enabled: true };
      mockTwoFactorRepo.findOne.mockResolvedValue(enabledRecord);
      mockTwoFactorRepo.save.mockImplementation(async (r) => r);
      mockUserRepo.findOne.mockResolvedValue({
        ...baseUser,
        twoFactorEnabled: true,
        twoFactorSecret: 'GENERATED_SECRET',
      });
      mockUserRepo.save.mockImplementation(async (u) => u);

      const result = await service.disableTwoFactor('user-1', '123456');

      expect(result.message).toBe('Two-factor authentication disabled successfully');

      const savedUser = mockUserRepo.save.mock.calls[0][0];
      expect(savedUser.twoFactorEnabled).toBe(false);
      expect(savedUser.twoFactorSecret).toBeNull();
    });

    it('should throw BadRequestException if 2FA is not enabled', async () => {
      mockTwoFactorRepo.findOne.mockResolvedValue({ ...baseRecord, enabled: false });

      await expect(service.disableTwoFactor('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getStatus', () => {
    it('should return enabled: true when record exists and is enabled', async () => {
      mockTwoFactorRepo.findOne.mockResolvedValue({ ...baseRecord, enabled: true });

      const result = await service.getStatus('user-1');
      expect(result).toEqual({ enabled: true, hasSetup: true });
    });

    it('should return enabled: false when no record exists', async () => {
      mockTwoFactorRepo.findOne.mockResolvedValue(null);

      const result = await service.getStatus('user-1');
      expect(result).toEqual({ enabled: false, hasSetup: false });
    });
  });

  describe('setupTwoFactor', () => {
    it('should create a new record with enabled: false', async () => {
      mockUserRepo.findOne.mockResolvedValue({ ...baseUser });
      mockTwoFactorRepo.findOne.mockResolvedValue(null);
      mockTwoFactorRepo.create.mockImplementation((data) => data);
      mockTwoFactorRepo.save.mockImplementation(async (r) => r);

      const result = await service.setupTwoFactor('user-1');

      expect(result.otpauthUrl).toBe('otpauth://totp/test');
      expect(result.qrCodeDataUrl).toBe('data:image/png;base64,qr');
      expect(result.backupCodes).toHaveLength(10);
      expect(mockTwoFactorRepo.save.mock.calls[0][0].enabled).toBe(false);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.setupTwoFactor('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
