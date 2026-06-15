import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { TaskCompletion, TaskCompletionStatus } from '../../tasks/entities/task-completion.entity';
import { HealthTask, TaskCategory } from '../../tasks/entities/health-task.entity';

export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface AnalyticsOptions {
  period?: AnalyticsPeriod;
  startDate?: Date;
  endDate?: Date;
  userId?: string;
}

export interface CategoryBreakdown {
  category: string;
  totalAttempted: number;
  totalCompleted: number;
  completionRate: number;
}

export interface TaskAnalyticsResult {
  period: string;
  totalAttempted: number;
  totalCompleted: number;
  completionRate: number;
  categoryBreakdown: CategoryBreakdown[];
  startDate: Date;
  endDate: Date;
}

@Injectable()
export class TaskAnalyticsService {
  private readonly logger = new Logger(TaskAnalyticsService.name);

  constructor(
    @InjectRepository(TaskCompletion)
    private readonly completionRepo: Repository<TaskCompletion>,
    @InjectRepository(HealthTask)
    private readonly taskRepo: Repository<HealthTask>
  ) {}

  calculateCompletionRate(completed: number, attempted: number): number {
    if (attempted === 0) return 0;
    return Math.round((completed / attempted) * 10000) / 100;
  }

  resolveDateRange(options: AnalyticsOptions): { startDate: Date; endDate: Date } {
    const now = new Date();
    const endDate = options.endDate || now;
    let startDate: Date;

    if (options.startDate) {
      startDate = options.startDate;
    } else {
      const period = options.period || 'weekly';
      const daysBack =
        period === 'daily' ? 1 : period === 'weekly' ? 7 : period === 'monthly' ? 30 : 7;
      startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate };
  }

  async getStats(options: AnalyticsOptions): Promise<TaskAnalyticsResult> {
    const { startDate, endDate } = this.resolveDateRange(options);

    const baseQuery = this.completionRepo
      .createQueryBuilder('completion')
      .leftJoin('completion.task', 'task')
      .where('completion.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      });

    if (options.userId) {
      baseQuery.andWhere('completion.userId = :userId', { userId: options.userId });
    }

    const totalAttempted = await this.completionRepo.count({
      where: {
        createdAt: Between(startDate, endDate),
        ...(options.userId ? { userId: options.userId as any } : {}),
      },
    });

    const totalCompleted = await this.completionRepo.count({
      where: {
        status: TaskCompletionStatus.VERIFIED,
        createdAt: Between(startDate, endDate),
        ...(options.userId ? { userId: options.userId as any } : {}),
      },
    });

    const categoryBreakdown = await this.getCategoryBreakdown(startDate, endDate, options.userId);

    return {
      period: options.period || 'weekly',
      totalAttempted,
      totalCompleted,
      completionRate: this.calculateCompletionRate(totalCompleted, totalAttempted),
      categoryBreakdown,
      startDate,
      endDate,
    };
  }

  async getWeeklyStats(): Promise<TaskAnalyticsResult> {
    return this.getStats({ period: 'weekly' });
  }

  async getDailyStats(): Promise<TaskAnalyticsResult> {
    return this.getStats({ period: 'daily' });
  }

  async getCategoryBreakdown(
    startDate: Date,
    endDate: Date,
    userId?: string
  ): Promise<CategoryBreakdown[]> {
    const qb = this.completionRepo
      .createQueryBuilder('completion')
      .leftJoin('completion.task', 'task')
      .select('task.category', 'category')
      .addSelect('COUNT(completion.id)', 'totalAttempted')
      .addSelect(
        `SUM(CASE WHEN completion.status = '${TaskCompletionStatus.VERIFIED}' THEN 1 ELSE 0 END)`,
        'totalCompleted'
      )
      .where('completion.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('task.category');

    if (userId) {
      qb.andWhere('completion.userId = :userId', { userId });
    }

    const raw = await qb.getRawMany();

    return raw.map((row: any) => ({
      category: row.category || 'uncategorized',
      totalAttempted: Number(row.totalAttempted),
      totalCompleted: Number(row.totalCompleted),
      completionRate: this.calculateCompletionRate(
        Number(row.totalCompleted),
        Number(row.totalAttempted)
      ),
    }));
  }
}
