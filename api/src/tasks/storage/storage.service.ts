import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { Env } from '../../config/env.js';

/**
 * File storage for attachments. Local disk for now; the interface is what an S3-compatible
 * driver would implement (planned for production hardening).
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(config.get('UPLOAD_DIR'));
  }

  /** Resolves a storage key to a path, refusing anything that escapes the upload root. */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    const rel = relative(this.root, full);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async read(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    try {
      await stat(path);
    } catch {
      throw new NotFoundException('File not found');
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
