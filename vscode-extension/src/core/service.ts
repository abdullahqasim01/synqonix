import { unwrap, type Api, type Schemas } from "./api";
import { branchNameFor, type Git } from "./git";
import { startStatus, type Task } from "./format";

export type TaskDetail = Schemas["TaskDetailDto"];
export type Status = Schemas["StatusDto"];
export type Priority = Task["priority"];
export type Workspace = Schemas["WorkspaceDto"];
export type Project = Schemas["ProjectDto"];
export type TimeEntry = Schemas["TimeEntryDto"];
export type Backlog = Schemas["BacklogDto"];

export interface StartWorkOptions {
  /** Folder of the repository to branch in. */
  cwd: string;
  moveToInProgress: boolean;
  assignToMe: boolean;
  /** Branch to start from; defaults to the current HEAD. */
  base?: string;
  startTimer?: boolean;
}

export interface StartWorkResult {
  branch: string;
  branchCreated: boolean;
  movedTo: string | null;
  assigned: boolean;
  timerStarted: boolean;
  task: TaskDetail;
}

/** Everything the extension asks of Synqonix, in terms of tasks rather than HTTP. */
export class TaskService {
  constructor(private readonly api: Api, private readonly git: Git) {}

  private get http() { return this.api.http; }

  // ---------------------------------------------------------------- who and where

  async me() {
    return unwrap(await this.http.GET("/api/v1/users/me"));
  }

  async workspaces(): Promise<Workspace[]> {
    return unwrap(await this.http.GET("/api/v1/workspaces"));
  }

  async members(workspaceId: string): Promise<Schemas["MemberDto"][]> {
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/members", { params: { path: { workspaceId } } }));
  }

  async projects(workspaceId: string): Promise<Project[]> {
    const all = unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/projects", { params: { path: { workspaceId } } }));
    return all.filter((p) => !p.archived);
  }

  async statuses(workspaceId: string, projectId: string): Promise<Status[]> {
    const p = unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}", { params: { path: { workspaceId, projectId } } }));
    return [...p.statuses].sort((a, b) => a.position - b.position);
  }

  // ---------------------------------------------------------------- lists

  /** Open tasks assigned to the caller, across all projects of the workspace. */
  async myTasks(workspaceId: string): Promise<Task[]> {
    const path = { workspaceId };
    const [todo, doing] = await Promise.all(
      (["TODO", "IN_PROGRESS"] as const).map(async (statusCategory) =>
        unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/tasks", { params: { path, query: { assignee: "me", statusCategory, excludeSubtasks: false, limit: 100 } } })).items),
    );
    return [...doing, ...todo];
  }

  async sprintTasks(workspaceId: string, projectId: string): Promise<Task[]> {
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/tasks", { params: { path: { workspaceId }, query: { projectId, sprintId: "active", limit: 100 } } })).items;
  }

  async backlog(workspaceId: string, projectId: string): Promise<Backlog> {
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/projects/{projectId}/backlog", { params: { path: { workspaceId, projectId } } }));
  }

  async recent(workspaceId: string): Promise<Task[]> {
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/recent-tasks", { params: { path: { workspaceId } } })).items;
  }

  /** Free-text search with the same filters as the web app (`assignee:me status:open`). */
  async search(workspaceId: string, q: string): Promise<Schemas["TaskHitDto"][]> {
    if (!q.trim()) return [];
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/search", { params: { path: { workspaceId }, query: { q, types: "tasks", limit: 20 } } })).tasks;
  }

  // ---------------------------------------------------------------- one task

  async task(workspaceId: string, key: string): Promise<TaskDetail> {
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}", { params: { path: { workspaceId, taskId: key } } }));
  }

  async comments(workspaceId: string, key: string) {
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/comments", { params: { path: { workspaceId, taskId: key } } }));
  }

  async activity(workspaceId: string, key: string) {
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/activity", { params: { path: { workspaceId, taskId: key }, query: { limit: 30 } } }));
  }

  async github(workspaceId: string, key: string) {
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/github", { params: { path: { workspaceId, taskId: key } } }));
  }

  // ---------------------------------------------------------------- changes

  async create(workspaceId: string, projectId: string, input: { title: string; type?: Task["type"]; description?: string; assignToMe?: boolean }): Promise<TaskDetail> {
    const me = input.assignToMe ? (await this.me()).id : undefined;
    return unwrap(await this.http.POST("/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks", {
      params: { path: { workspaceId, projectId } },
      body: { title: input.title, ...(input.type ? { type: input.type } : {}), ...(input.description ? { description: input.description } : {}), ...(me ? { assigneeIds: [me] } : {}) },
    }));
  }

  private async patch(workspaceId: string, key: string, body: Schemas["UpdateTaskDto"]): Promise<TaskDetail> {
    return unwrap(await this.http.PATCH("/api/v1/workspaces/{workspaceId}/tasks/{taskId}", { params: { path: { workspaceId, taskId: key } }, body }));
  }

  transition(workspaceId: string, key: string, statusId: string) { return this.patch(workspaceId, key, { statusId }); }
  setPriority(workspaceId: string, key: string, priority: Priority) { return this.patch(workspaceId, key, { priority }); }
  setAssignees(workspaceId: string, key: string, assigneeIds: string[]) { return this.patch(workspaceId, key, { assigneeIds }); }

  async assignToMe(workspaceId: string, key: string): Promise<TaskDetail> {
    const [me, task] = await Promise.all([this.me(), this.task(workspaceId, key)]);
    return task.assignees.some((a) => a.userId === me.id) ? task : this.setAssignees(workspaceId, key, [...task.assignees.map((a) => a.userId), me.id]);
  }

  async comment(workspaceId: string, key: string, body: string) {
    return unwrap(await this.http.POST("/api/v1/workspaces/{workspaceId}/tasks/{taskId}/comments", { params: { path: { workspaceId, taskId: key } }, body: { body } }));
  }

  // ---------------------------------------------------------------- time

  async timer(workspaceId: string): Promise<TimeEntry | null> {
    return unwrap(await this.http.GET("/api/v1/workspaces/{workspaceId}/time/timer", { params: { path: { workspaceId } } })).entry;
  }

  async startTimer(workspaceId: string, key: string): Promise<TimeEntry | null> {
    return unwrap(await this.http.POST("/api/v1/workspaces/{workspaceId}/time/timer/start", { params: { path: { workspaceId } }, body: { taskRef: key } })).entry;
  }

  /** Stops the running timer; the finished entry, or null if none was running (or it ran under a minute). */
  async stopTimer(workspaceId: string): Promise<TimeEntry | null> {
    return unwrap(await this.http.POST("/api/v1/workspaces/{workspaceId}/time/timer/stop", { params: { path: { workspaceId } } })).entry;
  }

  // ---------------------------------------------------------------- inbox

  async unreadNotifications(): Promise<Schemas["NotificationDto"][]> {
    return unwrap(await this.http.GET("/api/v1/notifications", { params: { query: { unread: true, limit: 30 } } })).items;
  }

  // ---------------------------------------------------------------- start working

  /**
   * "Start task": branch `syn-12-short-title` in the repository (created, or switched to when it
   * already exists), then — only if the branch worked — assign you, move the task to the first
   * in-progress status and start the timer, as asked.
   */
  async startWork(workspaceId: string, key: string, opts: StartWorkOptions): Promise<StartWorkResult> {
    let task = await this.task(workspaceId, key);
    const branch = branchNameFor(task.key, task.title);
    const branchCreated = await this.git.checkoutOrCreate(opts.cwd, branch, opts.base);

    let assigned = false;
    if (opts.assignToMe) {
      const me = await this.me();
      if (!task.assignees.some((a) => a.userId === me.id)) {
        task = await this.setAssignees(workspaceId, key, [...task.assignees.map((a) => a.userId), me.id]);
        assigned = true;
      }
    }
    let movedTo: string | null = null;
    if (opts.moveToInProgress) {
      const next = startStatus(await this.statuses(workspaceId, task.projectId), task.status);
      if (next) {
        task = await this.transition(workspaceId, key, next.id);
        movedTo = next.name;
      }
    }
    let timerStarted = false;
    if (opts.startTimer) timerStarted = (await this.startTimer(workspaceId, key)) !== null;
    return { branch, branchCreated, movedTo, assigned, timerStarted, task };
  }
}
