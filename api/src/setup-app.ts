import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { requestObserver } from './common/observability.js';
import { SocketIoAdapter } from './realtime/socket-adapter.js';

export interface SetupOptions {
  /** Reverse-proxy hops to trust for the client address. */
  trustProxy?: number;
  logFormat?: 'json' | 'pretty';
  /** No request or error logging (tests). */
  quiet?: boolean;
}

export function setupApp(app: NestExpressApplication, webUrl: string, opts: SetupOptions = {}) {
  const format = opts.logFormat ?? 'pretty';
  if (opts.trustProxy) app.set('trust proxy', opts.trustProxy);
  app.use(requestObserver(format, opts.quiet ?? process.env.NODE_ENV === 'test'));
  app.useGlobalFilters(new AllExceptionsFilter(format, opts.quiet ?? process.env.NODE_ENV === 'test'));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: [webUrl], credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useWebSocketAdapter(new SocketIoAdapter(app, webUrl));
  app.enableShutdownHooks();
}

export function buildOpenApi(app: NestExpressApplication) {
  const config = new DocumentBuilder()
    .setTitle('Synqonix API')
    .setDescription('Project management for developers')
    .setVersion('1')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
