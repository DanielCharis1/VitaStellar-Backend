import { Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PROOF_VERIFICATION_QUEUE } from '../../../queue/queue.constants';
import { ProofVerificationService } from './proof-verification.service';

@Processor(PROOF_VERIFICATION_QUEUE)
export class ProofVerificationProcessor {
  private readonly logger = new Logger(ProofVerificationProcessor.name);

  constructor(private proofVerificationService: ProofVerificationService) {}

  async process(job: Job): Promise<void> {
    const { completionId } = job.data;

    this.logger.log(`Processing proof verification for completion ${completionId}`);

    try {
      await this.proofVerificationService.verifyProof(completionId);
    } catch (err) {
      this.logger.error(`Proof verification failed for job ${job.id}: ${(err as Error).message}`);
      throw err;
    }
  }
}

