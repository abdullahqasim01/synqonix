import { io, type Socket } from "socket.io-client";
import { API_URL } from "@/lib/api/client";
import { tokenStore } from "@/lib/auth/token-store";

export interface TaskEvent {
  type: "created" | "updated" | "deleted" | "ranked" | "moved_out" | "commented";
  taskId: string;
  taskKey: string;
  projectId: string;
  actorId: string;
  fields?: string[];
  statusId?: string;
}

type Handler = (e: TaskEvent) => void;

let socket: Socket | null = null;
let refs = 0;
const handlers = new Map<string, Set<Handler>>();

/** Milliseconds until a JWT expires (0 if unreadable or already expired). */
export function msUntilExpiry(jwt: string | null): number {
  try {
    const payload = JSON.parse(atob(jwt!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return payload.exp ? payload.exp * 1000 - Date.now() : 0;
  } catch {
    return 0;
  }
}

/** The current access token, refreshed first if it is about to expire. */
async function freshToken(): Promise<string | null> {
  const token = tokenStore.get();
  if (token && msUntilExpiry(token) > 15_000) return token;
  return (await tokenStore.refresh()) ?? token;
}

function connection(): Socket {
  if (socket) return socket;
  const s = io(API_URL, {
    transports: ["websocket"],
    // Called on every (re)connect, so a long-lived page never reuses an expired token.
    auth: (cb) => void freshToken().then((token) => cb({ token })),
  });
  s.on("connect", () => {
    for (const projectId of handlers.keys()) s.emit("subscribe", { projectId });
  });
  s.on("task", (e: TaskEvent) => handlers.get(e.projectId)?.forEach((h) => h(e)));
  // The server drops sockets whose token expired; socket.io will not retry that by itself.
  s.on("disconnect", (reason) => {
    if (reason === "io server disconnect") s.connect();
  });
  socket = s;
  return s;
}

/**
 * Shares one connection between everything that wants live updates (boards, chat). The socket
 * closes when the last holder releases it.
 */
export function acquireSocket(): { socket: Socket; release(): void } {
  const s = connection();
  refs++;
  let released = false;
  return {
    socket: s,
    release() {
      if (released) return;
      released = true;
      if (--refs <= 0) {
        s.close();
        if (socket === s) socket = null;
        refs = 0;
      }
    },
  };
}

/** Listens to live task changes of a project. Returns an unsubscribe function. */
export function subscribeToProject(projectId: string, handler: Handler): () => void {
  const { socket: s, release } = acquireSocket();
  let set = handlers.get(projectId);
  if (!set) {
    set = new Set();
    handlers.set(projectId, set);
    if (s.connected) s.emit("subscribe", { projectId });
  }
  set.add(handler);
  return () => {
    const current = handlers.get(projectId);
    current?.delete(handler);
    if (current && current.size === 0) {
      handlers.delete(projectId);
      s.emit("unsubscribe", { projectId });
    }
    release();
  };
}
