import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { buildOpenApi, setupApp } from './setup-app.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  setupApp(app, config.get('WEB_URL'));

  const document = buildOpenApi(app);
  SwaggerModule.setup('docs', app, document);

  // `npm run generate:openapi` writes the spec consumed by web/ and vscode-extension/.
  if (process.env.OPENAPI_EXPORT) {
    writeFileSync('openapi.json', JSON.stringify(document, null, 2));
    await app.close();
    return;
  }

  await app.listen(config.get('PORT'));
}
await bootstrap();
