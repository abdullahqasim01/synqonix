import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

export interface SentMail { to: string; subject: string; text: string }

export class FakeMailService {
  sent: SentMail[] = [];
  async send(m: SentMail) { this.sent.push(m); }
  private url(to: string, path: string) {
    const mail = [...this.sent].reverse().find((m) => m.to === to && m.text.includes(path));
    return mail?.text.match(new RegExp(`${path}\\?token=([^\\s]+)`))?.[1];
  }
  sendVerificationEmail(u: { email: string; name: string }, token: string) {
    return this.send({ to: u.email, subject: 'verify', text: `/verify-email?token=${token}` });
  }
  sendPasswordResetEmail(u: { email: string; name: string }, token: string) {
    return this.send({ to: u.email, subject: 'reset', text: `/reset-password?token=${token}` });
  }
  tokenFor(to: string, path: 'verify-email' | 'reset-password') { return this.url(to, `/${path}`); }
}

export async function createTestApp({ throttle = false } = {}) {
  const mail = new FakeMailService();
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService).useValue(mail);
  process.env.THROTTLE_DISABLED = throttle ? '0' : '1';
  const mod = await builder.compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  setupApp(app, 'http://localhost:3000');
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, mail, prisma };
}
