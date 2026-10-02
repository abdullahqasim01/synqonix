import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Rate limiting applies to HTTP routes only; WebSocket messages are not throttled by this guard. */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== 'http' || super.shouldSkip(context);
  }
}
