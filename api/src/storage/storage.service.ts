/** A time-limited link the browser uses to send a file straight to the storage backend. */
export interface PresignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the browser must send exactly as given. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface PresignedDownload {
  url: string;
  expiresAt: string;
}

/** Every file is uploaded and downloaded with these links; the API never proxies file bytes in production. */
export abstract class StorageService {
  abstract readonly driver: 'local' | 's3';
  /** A link for uploading exactly `size` bytes to `key`. */
  abstract presignUpload(key: string, size: number): Promise<PresignedUpload>;
  /** A link that downloads `key` as an attachment named `filename`. */
  abstract presignDownload(key: string, filename: string): Promise<PresignedDownload>;
  /** Size of the stored object, or null when it does not exist. */
  abstract head(key: string): Promise<{ size: number } | null>;
  abstract delete(key: string): Promise<void>;
}

/** Uploads always use one content type so a signed link cannot be used to store something else. */
export const UPLOAD_CONTENT_TYPE = 'application/octet-stream';

/** Content-Disposition value that forces a download and keeps unicode names intact. */
export const attachmentDisposition = (filename: string) =>
  `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
