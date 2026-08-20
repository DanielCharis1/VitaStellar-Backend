import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskCompletion, TaskCompletionStatus } from '../../entities/task-completion.entity';
import { StorageService } from '../../../storage/storage.service';

@Injectable()
export class ProofVerificationService {
  private readonly logger = new Logger(ProofVerificationService.name);

  constructor(
    @InjectRepository(TaskCompletion)
    private taskCompletionRepo: Repository<TaskCompletion>,
    private storageService: StorageService,
    private eventEmitter: EventEmitter2
  ) {}

  async verifyProof(completionId: string): Promise<void> {
    const completion = await this.taskCompletionRepo.findOne({
      where: { id: completionId },
      relations: ['user', 'task'],
    });

    if (!completion) {
      this.logger.error(`Task completion ${completionId} not found`);
      return;
    }

    if (!completion.proofUrl) {
      this.logger.error(`No proof URL for completion ${completionId}`);
      await this.rejectCompletion(completion, 'No proof URL provided');
      return;
    }

    try {
      // Extract file key from proofUrl (assuming it's an S3 URL)
      const fileKey = this.extractFileKeyFromUrl(completion.proofUrl);

      const fileInfo = await this.storageService.verifyFileExists(fileKey);

      if (!fileInfo.exists) {
        await this.rejectCompletion(completion, 'Proof file not found in storage');
        return;
      }

      // Check content type
      if (!fileInfo.contentType || !['image/jpeg', 'image/png'].includes(fileInfo.contentType)) {
        await this.rejectCompletion(
          completion,
          'Invalid file type. Only JPEG and PNG images are allowed'
        );
        return;
      }

      // Check file size (5MB limit)
      if (fileInfo.size && fileInfo.size > 5 * 1024 * 1024) {
        await this.rejectCompletion(completion, 'File size exceeds 5MB limit');
        return;
      }

      // Verification passed
      await this.verifyCompletion(completion);
    } catch (error) {
      this.logger.error(`Error verifying proof for completion ${completionId}`, error);
      await this.rejectCompletion(completion, 'Verification failed due to system error');
    }
  }

  private async verifyCompletion(completion: TaskCompletion): Promise<void> {
    completion.status = TaskCompletionStatus.VERIFIED;
    await this.taskCompletionRepo.save(completion);

    this.logger.log(`Verified task completion ${completion.id}`);
    this.eventEmitter.emit('task.verified', {
      completionId: completion.id,
      userId: completion.user.id,
      taskId: completion.task.id,
      xlmAmount: completion.xlmRewarded,
    });
  }

  private async rejectCompletion(completion: TaskCompletion, reason: string): Promise<void> {
    completion.status = TaskCompletionStatus.REJECTED;
    completion.rejectionReason = reason;
    await this.taskCompletionRepo.save(completion);

    this.logger.log(`Rejected task completion ${completion.id}: ${reason}`);
    this.eventEmitter.emit('task.rejected', {
      completionId: completion.id,
      userId: completion.user.id,
      taskId: completion.task.id,
      reason,
    });
  }

  private extractFileKeyFromUrl(url: string): string {
    // Handle local-mode URLs: /api/storage/local-upload?key=proofs%2Fuser%2Ftask%2Fts
    if (url.includes('/api/storage/local-upload')) {
      const parsed = new URL(url, 'http://localhost');
      const key = parsed.searchParams.get('key');
      if (key) return decodeURIComponent(key);
    }

    // Handle S3 URLs: https://bucket.s3.amazonaws.com/proofs/user/task/timestamp?...
    const urlParts = url.split('/');
    const keyIndex = urlParts.findIndex((part) => part.includes('proofs'));
    if (keyIndex === -1) {
      throw new Error(`Cannot extract file key from URL: ${url}`);
    }
    // Strip query string from the last segment
    const lastSegment = urlParts[urlParts.length - 1].split('?')[0];
    return [...urlParts.slice(keyIndex, -1), lastSegment].join('/');
  }
}
