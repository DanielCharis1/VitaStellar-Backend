import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../../entities/user.entity';

export enum MilestoneType {
  XLM = 'xlm',
  STREAK = 'streak',
}

@Entity('user_milestones')
@Unique(['userId', 'milestoneType', 'milestoneValue'])
export class UserMilestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: MilestoneType })
  milestoneType: MilestoneType;

  @Column({ type: 'int' })
  milestoneValue: number;

  @CreateDateColumn({ type: 'timestamp' })
  awardedAt: Date;
}
