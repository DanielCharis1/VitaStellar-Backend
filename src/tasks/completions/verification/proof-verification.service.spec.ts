import { ProofVerificationService } from './proof-verification.service';

describe('ProofVerificationService', () => {
  let service: ProofVerificationService;

  beforeEach(() => {
    service = new ProofVerificationService(null as any, null as any, null as any);
  });

  describe('extractFileKeyFromUrl (via public access for testing)', () => {
    it('should extract key from S3 URL', () => {
      const url = 'https://my-bucket.s3.amazonaws.com/proofs/user1/task1/1234567890';
      const key = (service as any).extractFileKeyFromUrl(url);
      expect(key).toBe('proofs/user1/task1/1234567890');
    });

    it('should extract key from S3 URL with query string', () => {
      const url = 'https://my-bucket.s3.amazonaws.com/proofs/user1/task1/1234567890?X-Amz-Signature=abc';
      const key = (service as any).extractFileKeyFromUrl(url);
      expect(key).toBe('proofs/user1/task1/1234567890');
    });

    it('should extract key from local-mode URL', () => {
      const url = '/api/storage/local-upload?key=proofs%2Fuser1%2Ftask1%2F1234567890&contentType=image%2Fjpeg';
      const key = (service as any).extractFileKeyFromUrl(url);
      expect(key).toBe('proofs/user1/task1/1234567890');
    });

    it('should throw for URL without proofs segment', () => {
      const url = 'https://example.com/some/other/path';
      expect(() => (service as any).extractFileKeyFromUrl(url)).toThrow(
        'Cannot extract file key from URL'
      );
    });
  });
});
