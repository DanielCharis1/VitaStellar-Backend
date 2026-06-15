import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promises as fs } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface UploadResult {
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  url: string;
  path: string;
}

@Injectable()
export class StorageService {
  private s3Client: S3Client | null = null;
  private readonly logger = new Logger(StorageService.name);
  private bucketName: string;
  private readonly isLocalMode: boolean;
  private readonly localUploadDir: string;

  constructor() {
    this.bucketName = process.env.AWS_S3_BUCKET_NAME || '';
    this.isLocalMode = (process.env.STORAGE_MODE ?? '').toLowerCase() === 'local';
    this.localUploadDir = join(process.cwd(), 'uploads');

    if (this.isLocalMode) {
      this.logger.warn(
        'STORAGE_MODE=local: using local filesystem instead of S3. Do not use in production.'
      );
      this.ensureLocalDir(this.localUploadDir);
      return;
    }

    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!accessKeyId || !secretAccessKey) {
      this.logger.error('AWS Credentials are missing from environment variables!');
      throw new Error('StorageService: Missing AWS Credentials');
    }

    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      endpoint: process.env.AWS_S3_ENDPOINT,
      forcePathStyle: true,
    });
  }

  /**
   * Uploads a file. Uses S3 in production, local filesystem when STORAGE_MODE=local.
   */
  async uploadFile(file: any, folder: string = 'general'): Promise<string> {
    const multerFile = file as {
      originalname: string;
      buffer: Buffer;
      mimetype: string;
    };

    if (this.isLocalMode) {
      return this.uploadFileLocal(multerFile, folder);
    }

    const timestamp = Date.now();
    const fileKey = `${folder}/${timestamp}-${multerFile.originalname}`;

    try {
      await this.s3Client!.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: fileKey,
          Body: multerFile.buffer,
          ContentType: multerFile.mimetype,
        })
      );
      this.logger.log(`File uploaded successfully: ${fileKey}`);
      return fileKey;
    } catch (error: any) {
      this.logger.error(`Failed to upload file to S3`, error?.stack);
      throw new Error('Cloud storage upload failed');
    }
  }

  /**
   * Generates a download URL for a specific file.
   */
  async getDownloadUrl(fileKey: string, expiresIn: number = 3600): Promise<string> {
    if (this.isLocalMode) {
      return `/uploads/${fileKey}`;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
      });

      return await getSignedUrl(this.s3Client!, command, { expiresIn });
    } catch (error: any) {
      this.logger.error(`Failed to generate download URL for ${fileKey}`, error?.message);
      throw new Error('Could not generate file access URL');
    }
  }

  /**
   * Deletes a file.
   */
  async deleteFile(fileKey: string): Promise<void> {
    if (this.isLocalMode) {
      const filePath = join(this.localUploadDir, fileKey);
      try {
        await fs.unlink(filePath);
        this.logger.log(`File deleted successfully: ${fileKey}`);
      } catch (error) {
        this.logger.error(`Failed to delete file ${fileKey}`, (error as Error).message);
        throw new Error('Local storage deletion failed');
      }
      return;
    }

    try {
      await this.s3Client!.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: fileKey,
        })
      );
      this.logger.log(`File deleted successfully: ${fileKey}`);
    } catch (error: any) {
      this.logger.error(`Failed to delete file ${fileKey}`, error?.message);
      throw new Error('Cloud storage deletion failed');
    }
  }

  /**
   * Generates a pre-signed URL for direct-to-S3 uploads.
   * In local mode, returns a local upload endpoint instead.
   */
  async generatePresignedUploadUrl(
    userId: string,
    taskId: string,
    contentType: 'image/jpeg' | 'image/png'
  ) {
    if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
      throw new BadRequestException(
        'Invalid content type. Only image/jpeg and image/png are allowed.'
      );
    }

    const timestamp = Date.now();
    const fileKey = `proofs/${userId}/${taskId}/${timestamp}`;

    if (this.isLocalMode) {
      return {
        uploadUrl: `/api/storage/local-upload?key=${encodeURIComponent(fileKey)}&contentType=${encodeURIComponent(contentType)}`,
        fileKey,
      };
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    try {
      const uploadUrl = await getSignedUrl(this.s3Client!, command, {
        expiresIn: 900,
      });

      return { uploadUrl, fileKey };
    } catch (error: any) {
      this.logger.error('Failed to generate pre-signed URL', error?.message);
      throw new Error('Failed to generate pre-signed URL');
    }
  }

  /**
   * Verifies that a file exists.
   */
  async verifyFileExists(fileKey: string): Promise<{
    exists: boolean;
    contentType?: string;
    size?: number;
  }> {
    if (this.isLocalMode) {
      const filePath = join(this.localUploadDir, fileKey);
      try {
        const stats = await fs.stat(filePath);
        return { exists: true, size: stats.size };
      } catch {
        return { exists: false };
      }
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
      });

      const response = await this.s3Client!.send(command);

      return {
        exists: true,
        contentType: response.ContentType,
        size: response.ContentLength,
      };
    } catch (error: any) {
      if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
        return { exists: false };
      }
      this.logger.error(`Unexpected error verifying file: ${error?.message}`);
      throw error;
    }
  }

  private async uploadFileLocal(
    file: { originalname: string; buffer: Buffer; mimetype: string },
    folder: string
  ): Promise<string> {
    const filename = `${uuidv4()}-${file.originalname}`;
    const targetDir = join(this.localUploadDir, folder);
    await this.ensureLocalDir(targetDir);
    const filePath = join(targetDir, filename);
    await fs.writeFile(filePath, file.buffer);
    const fileKey = `${folder}/${filename}`;
    this.logger.log(`File saved locally: ${fileKey}`);
    return fileKey;
  }

  private async ensureLocalDir(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }
}
