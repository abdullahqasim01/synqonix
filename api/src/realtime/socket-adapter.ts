import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/** Socket.IO adapter that only accepts browsers from the configured web origin. */
export class SocketIoAdapter extends IoAdapter {
  constructor(app: INestApplicationContext, private readonly origin: string) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, { ...options, cors: { origin: [this.origin], credentials: true } } as ServerOptions);
  }
}
