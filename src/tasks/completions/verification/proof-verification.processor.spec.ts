import { Job } from 'bull';
import { ProofVerificationProcessor } from './proof-verification.processor';
import { ProofVerificationService } from './proof-verification.service';

describe('ProofVerificationProcessor', () => {
  let processor: ProofVerificationProcessor;
  let mockService: { verifyProof: jest.Mock };

  beforeEach(() => {
    mockService = { verifyProof: jest.fn().mockResolvedValue(undefined) };
    processor = new ProofVerificationProcessor(mockService as any);
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleVerifyProof', () => {
    it('should call verifyProof with the completionId from job data', async () => {
      const job = { id: 1, data: { completionId: 'comp-123' } } as unknown as Job;

      await processor.handleVerifyProof(job);

      expect(mockService.verifyProof).toHaveBeenCalledWith('comp-123');
    });

    it('should throw on service error so Bull retries the job', async () => {
      mockService.verifyProof.mockRejectedValue(new Error('storage down'));
      const job = { id: 2, data: { completionId: 'comp-456' } } as unknown as Job;

      await expect(processor.handleVerifyProof(job)).rejects.toThrow('storage down');
    });
  });
});
