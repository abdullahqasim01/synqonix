import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.js';
import { attachmentDisposition, UPLOAD_CONTENT_TYPE, type PresignedDownload, type PresignedUpload, StorageService } from './storage.service.js';

type S3Config = Pick<Env, 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE' | 'PRESIGN_TTL_SECONDS'>;

/**
 * Any S3-compatible bucket (Filebase, Cloudflare R2, MinIO, AWS). The bucket stays private:
 * browsers get time-limited presigned links for each upload and download.
 */
export class S3Storage extends StorageService {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;

  constructor(cfg: S3Config, client?: S3Client) {
    super();
    this.bucket = cfg.S3_BUCKET!;
    this.ttl = cfg.PRESIGN_TTL_SECONDS;
    this.client = client ?? new S3Client({
      region: cfg.S3_REGION,
      endpoint: cfg.S3_ENDPOINT,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE === '1',
      credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID!, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY! },
      // Newer SDKs add CRC checksums by default; S3-compatible services often reject them on presigned links.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async presignUpload(key: string, size: number): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: UPLOAD_CONTENT_TYPE, ContentLength: size }),
      // Signing these makes the service reject an upload of any other size or type.
      { expiresIn: this.ttl, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    return { url, method: 'PUT', headers: { 'Content-Type': UPLOAD_CONTENT_TYPE }, expiresAt: new Date(Date.now() + this.ttl * 1000).toISOString() };
  }

  async presignDownload(key: string, filename: string): Promise<PresignedDownload> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket, Key: key,
        ResponseContentDisposition: attachmentDisposition(filename),
        ResponseContentType: UPLOAD_CONTENT_TYPE,
      }),
      { expiresIn: this.ttl },
    );
    return { url, expiresAt: new Date(Date.now() + this.ttl * 1000).toISOString() };
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
