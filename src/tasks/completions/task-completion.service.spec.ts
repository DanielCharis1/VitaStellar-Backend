import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { TaskCompletionService } from './task-completion.service';
import { TaskCompletion, TaskCompletionStatus } from '../entities/task-completion.entity';
import { HealthTask } from '../entities/health-task.entity';
import { ProofType } from './dto/complete-task.dto';
import { PROOF_VERIFICATION_QUEUE } from '../../queue/queue.constants';

describe('TaskCompletionService', () => {
  let service: TaskCompletionService;

  const mockCompletionRepo = {
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockTaskRepo = {
    findOne: jest.fn(),
  };

  const mockProofQueue = {
    add: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskCompletionService,
        {
          provide: getRepositoryToken(TaskCompletion),
          useValue: mockCompletionRepo,
        },
        {
          provide: getRepositoryToken(HealthTask),
          useValue: mockTaskRepo,
        },
        {
          provide: getQueueToken(PROOF_VERIFICATION_QUEUE),
          useValue: mockProofQueue,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<TaskCompletionService>(TaskCompletionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('completeTask', () => {
    const userId = 'user-1';

    const mockTask = { id: 'task-1', xlmReward: 5 };

    const createEmptyQueryBuilder = () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      return qb;
    };

    beforeEach(() => {
      mockTaskRepo.findOne.mockResolvedValue(mockTask);
    });

    describe('SELF_REPORT path', () => {
      it('should emit task.verified and task.completed events without directly adding a reward job', async () => {
        mockCompletionRepo.createQueryBuilder.mockReturnValue(createEmptyQueryBuilder());
        mockCompletionRepo.create.mockReturnValue({
          id: 'comp-1',
          status: TaskCompletionStatus.VERIFIED,
          xlmRewarded: 5,
          completedAt: new Date(),
        });
        mockCompletionRepo.save.mockImplementation((c) => Promise.resolve(c));

        await service.completeTask(userId, {
          taskId: 'task-1',
          proofType: ProofType.SELF_REPORT,
        });

        // Should emit task.verified — this is the single source of truth for reward dispatch
        expect(mockEventEmitter.emit).toHaveBeenCalledWith('task.verified', {
          completionId: 'comp-1',
          userId,
          taskId: 'task-1',
          xlmAmount: 5,
        });

        // Should also emit task.completed for streak tracking
        expect(mockEventEmitter.emit).toHaveBeenCalledWith('task.completed', {
          completionId: 'comp-1',
          userId,
          taskId: 'task-1',
          xlmAmount: 5,
        });

        // Must NOT directly add a reward distribution job to any queue
        // (reward dispatch is handled exclusively by the task.verified event)
        expect(mockProofQueue.add).not.toHaveBeenCalled();
      });

      it('should persist the completion with VERIFIED status', async () => {
        mockCompletionRepo.createQueryBuilder.mockReturnValue(createEmptyQueryBuilder());
        mockCompletionRepo.create.mockReturnValue({
          id: 'comp-2',
          status: TaskCompletionStatus.VERIFIED,
          xlmRewarded: 5,
          completedAt: new Date(),
        });
        mockCompletionRepo.save.mockImplementation((c) => Promise.resolve(c));

        const result = await service.completeTask(userId, {
          taskId: 'task-1',
          proofType: ProofType.SELF_REPORT,
        });

        expect(result.status).toBe(TaskCompletionStatus.VERIFIED);
        expect(result.xlmRewarded).toBe(5);
      });
    });

    describe('PHOTO path', () => {
      it('should enqueue proof verification and emit task.completed but NOT emit task.verified or add reward job', async () => {
        mockCompletionRepo.createQueryBuilder.mockReturnValue(createEmptyQueryBuilder());
        mockCompletionRepo.create.mockReturnValue({
          id: 'comp-3',
          status: TaskCompletionStatus.PENDING,
          xlmRewarded: 5,
          completedAt: new Date(),
        });
        mockCompletionRepo.save.mockImplementation((c) => Promise.resolve(c));

        await service.completeTask(userId, {
          taskId: 'task-1',
          proofType: ProofType.PHOTO,
          proofUrl: 'https://bucket.s3.amazonaws.com/proofs/file.jpg',
        });

        // Should queue proof verification
        expect(mockProofQueue.add).toHaveBeenCalledWith(
          'verify-proof',
          { completionId: 'comp-3' },
          { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
        );

        // Should emit task.completed for streak tracking
        expect(mockEventEmitter.emit).toHaveBeenCalledWith('task.completed', {
          completionId: 'comp-3',
          userId,
          taskId: 'task-1',
          xlmAmount: 5,
        });

        // Must NOT emit task.verified — reward must not be dispatched before verification
        expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
          'task.verified',
          expect.anything(),
        );
      });

      it('should persist the completion with PENDING status', async () => {
        mockCompletionRepo.createQueryBuilder.mockReturnValue(createEmptyQueryBuilder());
        mockCompletionRepo.create.mockReturnValue({
          id: 'comp-4',
          status: TaskCompletionStatus.PENDING,
          xlmRewarded: 5,
          completedAt: new Date(),
        });
        mockCompletionRepo.save.mockImplementation((c) => Promise.resolve(c));

        const result = await service.completeTask(userId, {
          taskId: 'task-1',
          proofType: ProofType.PHOTO,
          proofUrl: 'https://bucket.s3.amazonaws.com/proofs/file.jpg',
        });

        expect(result.status).toBe(TaskCompletionStatus.PENDING);
      });

      it('should throw BadRequestException when PHOTO proof type is missing proofUrl', async () => {
        await expect(
          service.completeTask(userId, {
            taskId: 'task-1',
            proofType: ProofType.PHOTO,
          }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('validation', () => {
      it('should throw NotFoundException when task does not exist', async () => {
        mockTaskRepo.findOne.mockResolvedValue(null);

        await expect(
          service.completeTask(userId, {
            taskId: 'nonexistent',
            proofType: ProofType.SELF_REPORT,
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('should throw ConflictException when task was completed within 24 hours', async () => {
        const qb = createEmptyQueryBuilder();
        qb.getOne.mockResolvedValue({ completedAt: new Date() });
        mockCompletionRepo.createQueryBuilder.mockReturnValue(qb);

        await expect(
          service.completeTask(userId, {
            taskId: 'task-1',
            proofType: ProofType.SELF_REPORT,
          }),
        ).rejects.toThrow(ConflictException);
      });
    });
  });

  describe('getUserCompletions', () => {
    it('should query completions for the given user', async () => {
      const mockCompletions = [
        { id: 'c1', task: { id: 't1' } },
        { id: 'c2', task: { id: 't2' } },
      ];

      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockCompletions),
      };
      mockCompletionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getUserCompletions('user-1');

      expect(result).toEqual(mockCompletions);
      expect(qb.where).toHaveBeenCalledWith('c.userId = :userId', { userId: 'user-1' });
    });
  });
});
