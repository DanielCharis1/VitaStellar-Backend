import { EventEmitter2 } from '@nestjs/event-emitter';
import { RewardService } from './reward.service';
import { MilestoneType } from './entities/user-milestone.entity';

describe('RewardService - Milestone Deduplication', () => {
  let service: RewardService;
  let mockRewardRepo: any;
  let mockMilestoneRepo: any;
  let mockEventEmitter: EventEmitter2;

  beforeEach(() => {
    mockRewardRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '15' }),
      }),
    };

    mockMilestoneRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data) => data),
      save: jest.fn().mockImplementation(async (data) => data),
    };

    mockEventEmitter = { emit: jest.fn() } as any;

    service = new RewardService(
      mockRewardRepo,
      null, // taskCompletionRepo
      null, // healthTaskRepo
      mockMilestoneRepo, // userMilestoneRepo
      null, // userRepo
      null, // cacheManager
      null, // rewardQueue
      mockEventEmitter,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('emitMilestoneIfReached', () => {
    it('should emit only for milestones not yet awarded', async () => {
      // User has 15 XLM total, already awarded the 10 XLM milestone
      mockMilestoneRepo.find.mockResolvedValue([
        { milestoneValue: 10, milestoneType: MilestoneType.XLM },
      ]);

      await service.emitMilestoneIfReached('user-1');

      // Should emit for 15 >= 25? No. 15 >= 10? Already awarded. So nothing emitted.
      // Actually 15 < 25, so only 10 would match, but it's already awarded
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should emit for new milestones and persist them', async () => {
      mockMilestoneRepo.find.mockResolvedValue([]);

      await service.emitMilestoneIfReached('user-1');

      // totalXlm=15, milestones: 10 (15>=10 yes), 25 (15>=25 no)
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'reward.milestone',
        expect.objectContaining({ milestoneReached: 10 }),
      );
      expect(mockMilestoneRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should emit for multiple new milestones when crossing several thresholds', async () => {
      mockRewardRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '60' }),
      });
      mockMilestoneRepo.find.mockResolvedValue([]);

      await service.emitMilestoneIfReached('user-1');

      // 60 >= 10, 25, 50 but not 100, 250
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(3);
      expect(mockMilestoneRepo.save).toHaveBeenCalledTimes(3);
    });

    it('should not re-emit already awarded milestones', async () => {
      mockRewardRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '60' }),
      });
      mockMilestoneRepo.find.mockResolvedValue([
        { milestoneValue: 10, milestoneType: MilestoneType.XLM },
        { milestoneValue: 25, milestoneType: MilestoneType.XLM },
      ]);

      await service.emitMilestoneIfReached('user-1');

      // 60 >= 10 (awarded), 25 (awarded), 50 (new) → only 1 emit
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'reward.milestone',
        expect.objectContaining({ milestoneReached: 50 }),
      );
    });
  });
});
