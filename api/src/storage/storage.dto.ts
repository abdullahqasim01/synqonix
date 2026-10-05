import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RequestUploadDto {
  @IsString() @MinLength(1) @MaxLength(255)
  filename: string;

  /** Exact size in bytes; the upload link only accepts a file of this size. */
  @IsInt() @Min(1) @Max(5 * 1024 * 1024 * 1024)
  size: number;

  /** What the file is (for display); defaults to application/octet-stream. */
  @IsOptional() @IsString() @MaxLength(200)
  mimeType?: string;
}

export class UploadTargetDto {
  /** Send the file with a plain `PUT` to this URL, with exactly these headers and no Authorization header. */
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
  /** Pass this back to confirm the upload once the PUT has succeeded. */
  uploadToken: string;
}

export class ConfirmUploadDto {
  @IsString() @MinLength(10) @MaxLength(4000)
  uploadToken: string;
}

export class DownloadUrlDto {
  /** Time-limited link; open it to download the file. */
  url: string;
  expiresAt: string;
}
