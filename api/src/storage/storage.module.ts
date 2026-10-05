import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { LocalStorage } from './local-storage.js';
import { LocalStorageController } from './local-storage.controller.js';
import { S3Storage } from './s3-storage.js';
import { SignedTokens } from './signed-token.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  controllers: [LocalStorageController],
  providers: [
    SignedTokens,
    {
      provide: StorageService,
      inject: [ConfigService, SignedTokens],
      useFactory: (config: ConfigService<Env, true>, tokens: SignedTokens): StorageService => {
        const get = <K extends keyof Env>(k: K) => config.get(k, { infer: true }) as Env[K];
        return get('STORAGE_DRIVER') === 's3'
          ? new S3Storage({
              S3_ENDPOINT: get('S3_ENDPOINT'), S3_REGION: get('S3_REGION'), S3_BUCKET: get('S3_BUCKET'), S3_ACCESS_KEY_ID: get('S3_ACCESS_KEY_ID'),
              S3_SECRET_ACCESS_KEY: get('S3_SECRET_ACCESS_KEY'), S3_FORCE_PATH_STYLE: get('S3_FORCE_PATH_STYLE'), PRESIGN_TTL_SECONDS: get('PRESIGN_TTL_SECONDS'),
            })
          : new LocalStorage({ UPLOAD_DIR: get('UPLOAD_DIR'), PRESIGN_TTL_SECONDS: get('PRESIGN_TTL_SECONDS'), API_PUBLIC_URL: get('API_PUBLIC_URL'), PORT: get('PORT') }, tokens);
      },
    },
  ],
  exports: [StorageService, SignedTokens],
})
export class StorageModule {}
