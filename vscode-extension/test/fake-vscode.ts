/**
 * A small stand-in for the `vscode` module so the extension's glue can run under Vitest.
 * It records what the extension shows and answers prompts from a script the test controls.
 */
type Fn = (...a: never[]) => unknown;

export class EventEmitter<T> {
  private fns: ((e: T) => unknown)[] = [];
  event = (fn: (e: T) => unknown) => { this.fns.push(fn); return { dispose: () => { this.fns = this.fns.filter((f) => f !== fn); } }; };
  fire(e: T) { for (const f of [...this.fns]) f(e); }
  dispose() { this.fns = []; }
}
export class Disposable {
  constructor(private readonly fn?: () => void) {}
  dispose() { this.fn?.(); }
  static from(...items: { dispose(): unknown }[]) { return new Disposable(() => items.forEach((i) => i.dispose())); }
}
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export class TreeItem {
  description?: string; iconPath?: unknown; contextValue?: string; tooltip?: string; command?: { command: string; arguments?: unknown[] };
  constructor(public label: string, public collapsibleState = TreeItemCollapsibleState.None) {}
}
export class ThemeIcon { constructor(public id: string) {} }
export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum ViewColumn { Active = -1, Beside = -2, One = 1 }
export class RelativePattern { constructor(public base: string, public pattern: string) {} }
export class Uri {
  private constructor(public scheme: string, public authority: string, public path: string, public query: string, private readonly raw: string) {}
  static parse(s: string) { const u = new URL(s); return new Uri(u.protocol.replace(":", ""), u.host, u.pathname, u.search.replace(/^\?/, ""), s); }
  static file(p: string) { return new Uri("file", "", p, "", `file://${p}`); }
  get fsPath() { return this.path; }
  toString() { return this.raw; }
}

export const host = {
  opened: [] as string[],
  messages: [] as { level: "info" | "warn" | "error"; text: string }[],
  clipboard: "",
  folders: [] as string[],
  config: {} as Record<string, unknown>,
  /** Answers consumed by quick picks / input boxes, in order. A function receives the items. */
  answers: [] as unknown[],
  /** Button chosen for information/warning messages, by message text prefix. */
  buttons: [] as string[],
  commands: new Map<string, Fn>(),
  secrets: new Map<string, string>(),
  statusBars: [] as { text: string; visible: boolean; command?: string; dispose(): void; show(): void; hide(): void }[],
  panels: [] as { viewType: string; title: string; webview: { html: string; posted: unknown[]; handler?: (m: unknown) => unknown; cspSource: string; onDidReceiveMessage(fn: (m: unknown) => unknown): void }; disposed: boolean }[],
  uriHandler: undefined as undefined | { handleUri(u: Uri): unknown },
  reset() {
    this.opened = []; this.messages = []; this.clipboard = ""; this.folders = []; this.config = {}; this.answers = []; this.buttons = [];
    this.commands.clear(); this.secrets.clear(); this.statusBars = []; this.panels = []; this.uriHandler = undefined;
  },
};

const nextAnswer = (items?: unknown) => {
  if (host.answers.length === 0) throw new Error("fake-vscode: a prompt appeared that the test did not script");
  const a = host.answers.shift();
  return typeof a === "function" ? (a as (i: unknown) => unknown)(items) : a;
};

const message = (level: "info" | "warn" | "error") => async (text: string, ...rest: unknown[]) => {
  host.messages.push({ level, text });
  const buttons = rest.filter((r): r is string => typeof r === "string");
  const i = host.buttons.findIndex((b) => buttons.includes(b));
  return i >= 0 ? host.buttons.splice(i, 1)[0] : undefined;
};

export const commands = {
  registerCommand(id: string, fn: Fn) { host.commands.set(id, fn); return new Disposable(() => host.commands.delete(id)); },
  async executeCommand(id: string, ...args: unknown[]) {
    if (id === "setContext") return undefined;
    const fn = host.commands.get(id);
    if (!fn) throw new Error(`fake-vscode: unknown command ${id}`);
    return (fn as (...a: unknown[]) => unknown)(...args);
  },
};

export const window = {
  showInformationMessage: message("info"),
  showWarningMessage: message("warn"),
  showErrorMessage: message("error"),
  async showQuickPick(items: unknown[]) {
    const r = nextAnswer(items);
    // A scripted string picks the item whose label starts with it.
    return typeof r === "string" ? items.find((i) => (typeof i === "string" ? i : (i as { label: string }).label).startsWith(r)) : r;
  },
  async showInputBox() { return nextAnswer() as string | undefined; },
  createOutputChannel() { return { appendLine() {}, show() {}, dispose() {} }; },
  createStatusBarItem() {
    const item = { text: "", visible: false, command: undefined as string | undefined, tooltip: "", show() { item.visible = true; }, hide() { item.visible = false; }, dispose() { item.visible = false; } };
    host.statusBars.push(item);
    return item;
  },
  createTreeView() { return new Disposable(); },
  createWebviewPanel(viewType: string, title: string) {
    const webview = { html: "", posted: [] as unknown[], handler: undefined as undefined | ((m: unknown) => unknown), cspSource: "vscode-resource:", onDidReceiveMessage(fn: (m: unknown) => unknown) { webview.handler = fn; } };
    const panel = { viewType, title, webview, disposed: false, reveal() {}, onDidDispose() { return new Disposable(); }, dispose() { panel.disposed = true; } };
    host.panels.push(panel);
    return panel;
  },
  registerUriHandler(h: { handleUri(u: Uri): unknown }) { host.uriHandler = h; return new Disposable(); },
};

export const workspace = {
  getConfiguration() { return { get: <T>(k: string) => host.config[k] as T | undefined }; },
  get workspaceFolders() { return host.folders.map((f) => ({ uri: Uri.file(f) })); },
  createFileSystemWatcher() { return { onDidChange: () => new Disposable(), onDidCreate: () => new Disposable(), dispose() {} }; },
};

export const env = {
  async openExternal(u: Uri) { host.opened.push(u.toString()); return true; },
  clipboard: { writeText: async (t: string) => { host.clipboard = t; } },
};

export const extensions = { getExtension: () => undefined };
