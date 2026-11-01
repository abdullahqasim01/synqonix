import { BadRequestException, Controller, Get, HttpCode, NotFoundException, Put, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Public } from '../common/decorators.js';
import { LocalStorage } from './local-storage.js';
import { SignedTokens } from './signed-token.js';
import { attachmentDisposition, StorageService } from './storage.service.js';

/**
 * Development-only endpoints behind the local driver's links. The signed token is the credential,
 * exactly as with an S3 presigned URL. With the S3 driver these routes do not exist.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('storage/local')
export class LocalStorageController {
  constructor(private readonly storage: StorageService, private readonly tokens: SignedTokens) {}

  private local(): LocalStorage {
    if (!(this.storage instanceof LocalStorage)) throw new NotFoundException();
    return this.storage;
  }

  @Put('upload') @HttpCode(200)
  async upload(@Query('token') token: string, @Req() req: Request) {
    const local = this.local();
    const claims = this.tokens.verify<{ op: string; key: string; size: number }>(token);
    if (claims.op !== 'put') throw new BadRequestException('Not an upload link');
    if (Number(req.headers['content-length']) !== claims.size) throw new BadRequestException('The file size does not match the upload link');
    const path = await local.prepare(claims.key);
    let written = 0;
    req.on('data', (c: Buffer) => { written += c.length; });
    try {
      await pipeline(req, createWriteStream(path));
    } catch (e) {
      await rm(path, { force: true });
      throw e;
    }
    if (written !== claims.size) {
      await rm(path, { force: true });
      throw new BadRequestException('The upload was incomplete');
    }
    return { ok: true };
  }

  @Get('download')
  async download(@Query('token') token: string, @Res() res: Response) {
    const local = this.local();
    const claims = this.tokens.verify<{ op: string; key: string; filename: string }>(token);
    if (claims.op !== 'get') throw new BadRequestException('Not a download link');
    const path = local.pathFor(claims.key);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      throw new NotFoundException('File not found');
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', attachmentDisposition(claims.filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(path).pipe(res);
  }
}
