import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  RewardHistoryQueryDto,
  RewardHistoryResponseDto,
  RewardHistoryItemDto,
} from './dto/reward-history.dto';
import { RewardTransaction } from './entities/reward-transaction.entity';
import { RewardStatus } from './enums/reward-status.enum';
import { TaskCompletion } from '../tasks/entities/task-completion.entity';
import { HealthTask } from '../entities/health-task.entity';
import { User } from '../entities/user.entity';
import { StellarService } from '../stellar/stellar.service';
import { REWARD_QUEUE, REWARD_DISTRIBUTION_JOB } from '../queue/queue.constants';
import { REWARD_MILESTONE_EVENT } from '../coupons/coupon.events';
import { UserMilestone, MilestoneType } from './entities/user-milestone.entity';

const XLM_MILESTONES = [10, 25, 50, 100, 250];

@Injectable()
export class RewardService {
  private readonly logger = new Logger(RewardService.name);

  constructor(
    @InjectRepository(RewardTransaction)
    private readonly rewardTransactionRepository: Repository<RewardTransaction>,
    @InjectRepository(TaskCompletion)
    private readonly taskCompletionRepository: Repository<TaskCompletion>,
    @InjectRepository(HealthTask)
    private readonly healthTaskRepository: Repository<HealthTask>,
    @InjectRepository(UserMilestone)
    private readonly userMilestoneRepository: Repository<UserMilestone>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserMilestone)
    private readonly userMilestoneRepository: Repository<UserMilestone>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @InjectQueue(REWARD_QUEUE) private readonly rewardQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly stellarService: StellarService
  ) {}

  @OnEvent('task.verified')
  async handleTaskVerified(payload: {
    completionId: string;
    userId: string;
    taskId: string;
    xlmAmount: number;
  }) {
    await this.rewardQueue.add(REWARD_DISTRIBUTION_JOB, {
      completionId: payload.completionId,
      userId: payload.userId,
      xlmAmount: payload.xlmAmount,
    });
  }

  /**
   * Call after recording a new reward (e.g. from reward distribution job).
   * Emits reward.milestone when user's total XLM crosses a NEW threshold;
   * each threshold is emitted at most once per user via the user_milestones ledger.
   */
  async emitMilestoneIfReached(userId: string): Promise<void> {
    const result = await this.rewardTransactionRepository
      .createQueryBuilder('rt')
      .select('COALESCE(SUM(rt.amount), 0)', 'sum')
      .where('rt.userId = :userId', { userId })
      .andWhere('rt.status = :status', { status: RewardStatus.SUCCESS })
      .getRawOne<{ sum: string }>();

    const totalXlm = parseFloat(result?.sum ?? '0');

    // Load already-awarded XLM milestones for this user
    const awarded = await this.userMilestoneRepository.find({
      where: { userId, milestoneType: MilestoneType.XLM },
    });
    const awardedValues = new Set(awarded.map((m) => m.milestoneValue));

    for (const milestone of XLM_MILESTONES) {
      if (totalXlm >= milestone && !awardedValues.has(milestone)) {
        // Persist the milestone award before emitting to prevent duplicates on retry
        await this.userMilestoneRepository.save(
          this.userMilestoneRepository.create({
            userId,
            milestoneType: MilestoneType.XLM,
            milestoneValue: milestone,
          })
        );

        this.eventEmitter.emit(REWARD_MILESTONE_EVENT, {
          userId,
          totalXlm,
          milestoneReached: milestone,
        });

        this.logger.log(`Emitted ${REWARD_MILESTONE_EVENT} for user ${userId}: ${milestone} XLM`);
      }
    }
  }

  /**
   * Re-enqueue reward jobs for all PENDING reward transactions belonging
   * to a user. Called after the user links a Stellar wallet so previously
   * stranded payouts can be retried.
   *
   * The idempotency guard in processRewardJob (SUCCESS check on
   * taskCompletionId) ensures already-paid completions are not double-paid.
   */
  async retryPendingRewardsForUser(userId: string): Promise<number> {
    const pendingTransactions = await this.rewardTransactionRepository.find({
      where: { userId, status: RewardStatus.PENDING },
    });

    let enqueued = 0;
    for (const tx of pendingTransactions) {
      // Only re-enqueue completions with a taskCompletionId
      if (!tx.taskCompletionId) continue;

      await this.rewardQueue.add(REWARD_DISTRIBUTION_JOB, {
        completionId: tx.taskCompletionId,
        userId,
        xlmAmount: tx.amount,
      });
      enqueued++;
    }

    if (enqueued > 0) {
      this.logger.log(
        `Re-enqueued ${enqueued} pending reward job(s) for user ${userId} after wallet link`,
      );
    }

    return enqueued;
  }

  @OnEvent('wallet.linked')
  async handleWalletLinked(payload: { userId: string; address: string }) {
    this.logger.log(
      `Wallet linked for user ${payload.userId}; retrying pending rewards`,
    );
    await this.retryPendingRewardsForUser(payload.userId);
  }

  async getRewardHistory(
    userId: string,
    queryDto: RewardHistoryQueryDto
  ): Promise<RewardHistoryResponseDto> {
    const { page = 1, limit = 20, startDate, endDate, categoryId, status } = queryDto;
    const skip = (page - 1) * limit;

    // Create cache key
    const cacheKey = `reward_history:${userId}:${JSON.stringify(queryDto)}`;

    // Try to get from cache first
    const cachedResult = await this.cacheManager.get<RewardHistoryResponseDto>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Build query with joins
    const queryBuilder = this.rewardTransactionRepository
      .createQueryBuilder('reward_transaction')
      .leftJoinAndSelect('reward_transaction.task_completion', 'task_completion')
      .leftJoinAndSelect('task_completion.health_task', 'health_task')
      .where('reward_transaction.userId = :userId', { userId })
      .orderBy('reward_transaction.createdAt', 'DESC');

    // Apply date filters
    if (startDate) {
      queryBuilder.andWhere('reward_transaction.createdAt >= :startDate', {
        startDate: new Date(startDate),
      });
    }

    if (endDate) {
      queryBuilder.andWhere('reward_transaction.createdAt <= :endDate', {
        endDate: new Date(endDate),
      });
    }

    // Apply category filter
    if (categoryId) {
      queryBuilder.andWhere('health_task.categoryId = :categoryId', {
        categoryId,
      });
    }

    // Apply status filter
    if (status) {
      queryBuilder.andWhere('reward_transaction.status = :status', {
        status,
      });
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Get paginated results
    const rewardTransactions = await queryBuilder.skip(skip).take(limit).getMany();

    // Transform to DTO format
    const data: RewardHistoryItemDto[] = rewardTransactions.map((transaction) => ({
      id: transaction.id,
      amount: transaction.amount,
      status: transaction.status,
      stellarTxHash:
        transaction.status === RewardStatus.SUCCESS ? transaction.stellarTxHash : undefined,
      taskTitle: transaction.task_completion?.task?.title || 'Unknown Task',
      categoryId: transaction.task_completion?.task?.categoryId,
      createdAt: transaction.createdAt,
    }));

    const result: RewardHistoryResponseDto = {
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };

    // Cache the result for 2 minutes (120 seconds)
    await this.cacheManager.set(cacheKey, result, 120000);

    return result;
  }

  async processRewardJob(completionId: string, userId: string, amount: number): Promise<void> {
    this.logger.log(`Processing reward for user ${userId}, completion ${completionId}`);

    let transaction: RewardTransaction | null = null;

    if (completionId) {
      transaction = await this.rewardTransactionRepository.findOne({
        where: { taskCompletionId: completionId },
      });
    }

    // Idempotency guard: if this completion has already been paid, do nothing.
    // This prevents duplicate payouts from Bull retries or at-least-once delivery.
    if (transaction && transaction.status === RewardStatus.SUCCESS) {
      this.logger.warn(
        `Reward for completion ${completionId} already succeeded (tx ${transaction.id}); skipping duplicate job`
      );
      return;
    }

    // Idempotency guard: if this completion has already been paid, do nothing.
    // This prevents duplicate payouts from Bull retries or at-least-once delivery.
    if (transaction && transaction.status === RewardStatus.SUCCESS) {
      this.logger.warn(
        `Reward for completion ${completionId} already succeeded (tx ${transaction.id}); skipping duplicate job`
      );
      return;
    }

    if (!transaction) {
      transaction = this.rewardTransactionRepository.create({
        user: { id: userId } as any,
        task_completion: completionId ? ({ id: completionId } as any) : null,
        amount,
        status: RewardStatus.PENDING,
        attempts: 0,
      });
      await this.rewardTransactionRepository.save(transaction);
    }

    transaction.attempts += 1;

    // Look up the user's linked Stellar wallet address
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error(`User ${userId} not found for reward payout`);
    }

    const walletAddress = user.stellarWalletAddress || user.walletAddress;
    if (!walletAddress) {
      this.logger.warn(
        `User ${userId} has no linked Stellar wallet; marking reward PENDING for later retry`
      );
      throw new Error(
        `User ${userId} has no linked Stellar wallet address; cannot complete payout`
      );
      transaction.status = RewardStatus.PENDING;
      await this.rewardTransactionRepository.save(transaction);
      return;
    }

    try {
      const result = await this.stellarService.sendPayment(walletAddress, amount);

      transaction.stellarTxHash = result.stellarTxHash;
      transaction.status = RewardStatus.SUCCESS;
      await this.rewardTransactionRepository.save(transaction);

      this.logger.log(
        `Successfully distributed ${amount} XLM to user ${userId} (tx: ${result.stellarTxHash})`
      );
    } catch (error) {
      transaction.status = RewardStatus.FAILED;
      await this.rewardTransactionRepository.save(transaction);
      throw error; // Re-throw for Bull retry
    }
  }

  async handleRewardFailure(completionId: string) {
    const transaction = await this.rewardTransactionRepository.findOne({
      where: { taskCompletionId: completionId },
    });

    if (transaction) {
      transaction.status = RewardStatus.FAILED;
      await this.rewardTransactionRepository.save(transaction);
    }

    this.logger.error(`Max retries reached for completion ${completionId}. Marking as FAILED.`);
  }
}
