"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Input, Select } from "@/components/ui/form";
import { MultiSelect } from "@/components/tasks/multi-select";
import { TaskList } from "@/components/tasks/task-list";
import { ActiveSprintBanner } from "@/components/agile/active-sprint-banner";
import { TaskPanel, useTaskPanel } from "@/components/tasks/task-panel";
import { BoardView } from "@/components/views/board";
import { CalendarView } from "@/components/views/calendar";
import { FilterBar } from "@/components/views/filter-bar";
import { TimelineView } from "@/components/views/timeline";
import { useProject } from "@/components/workspace/project-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";
import {
  CARD_FIELDS, LAYOUTS, LIST_COLUMNS, defaultViewState, fromView, layoutToApi, sameQuery, toViewQuery,
  type Layout, type Swimlane, type ViewState,
} from "@/lib/view-state";
import { cn } from "@/lib/utils";

type SavedView = Schemas["ViewDto"];

/** Layout switcher, saved views, filters and the chosen layout, for one project. Needs <Suspense>. */
export function ProjectViews() {
  const { workspace } = useWorkspace();
  const { project } = useProject();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { openRef, open } = useTaskPanel();
  const ws = workspace.id;

  const layoutParam = params.get("layout");
  const layout: Layout = LAYOUTS.some((l) => l.value === layoutParam) ? (layoutParam as Layout) : "list";
  const viewParam = params.get("view");

  const [filters, setFilters] = useState<ViewState>(() => defaultViewState());
  const state: ViewState = { ...filters, layout };
  const [applied, setApplied] = useState<SavedView | null>(null);
  const [appliedFromUrl, setAppliedFromUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  const views = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/views", { params: { path: { workspaceId: ws }, query: { projectId: project.id } } }), [ws, project.id, version]);

  const setUrl = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v); }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const scrum = project.methodology === "SCRUM";
  const setLayout = (l: Layout) => {
    // A Scrum board shows the running sprint unless the user chose another scope.
    if (l === "board" && scrum && filters.filters.sprintId === "") setFilters({ ...filters, filters: { ...filters.filters, sprintId: "active" } });
    setUrl({ layout: l === "list" ? null : l });
  };
  const update = (next: ViewState) => { setFilters(next); if (next.layout !== layout) setLayout(next.layout); };

  const applyView = (v: SavedView | null) => {
    setApplied(v);
    setMessage(null);
    if (v) {
      const s = fromView(v);
      setFilters(s);
      setUrl({ view: v.id, layout: s.layout === "list" ? null : s.layout });
    } else {
      setFilters(defaultViewState());
      setUrl({ view: null, layout: null });
    }
  };

  // Open a view named in the URL (shared links) once it has loaded.
  const fromUrl = useQuery(
    async () => (viewParam && viewParam !== appliedFromUrl ? api.GET("/api/v1/workspaces/{workspaceId}/views/{viewId}", { params: { path: { workspaceId: ws, viewId: viewParam } } }) : { data: undefined }),
    [ws, viewParam, appliedFromUrl],
  );
  if (fromUrl.data && viewParam === fromUrl.data.id && appliedFromUrl !== viewParam) {
    setAppliedFromUrl(viewParam);
    setApplied(fromUrl.data);
    setFilters(fromView(fromUrl.data));
  }

  const dirty = applied ? !sameQuery(state, fromView(applied)) : false;

  async function saveNew(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { data, error } = await api.POST("/api/v1/workspaces/{workspaceId}/views", {
      params: { path: { workspaceId: ws } },
      body: {
        name: String(f.get("name")), projectId: project.id, layout: layoutToApi(layout),
        scope: f.get("shared") ? "SHARED" : "PERSONAL", query: toViewQuery(state),
      },
    });
    if (!data) return setMessage({ ok: false, text: errorMessage(error) });
    setSaving(false);
    setApplied(data);
    setMessage({ ok: true, text: `Saved “${data.name}”.` });
    setUrl({ view: data.id });
    setVersion((v) => v + 1);
  }

  async function updateApplied() {
    if (!applied) return;
    const { data, error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/views/{viewId}", {
      params: { path: { workspaceId: ws, viewId: applied.id } }, body: { layout: layoutToApi(layout), query: toViewQuery(state) },
    });
    if (!data) return setMessage({ ok: false, text: errorMessage(error) });
    setApplied(data);
    setMessage({ ok: true, text: "View updated." });
    setVersion((v) => v + 1);
  }

  async function deleteApplied() {
    if (!applied || !confirm(`Delete the view “${applied.name}”?`)) return;
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/views/{viewId}", { params: { path: { workspaceId: ws, viewId: applied.id } } });
    if (error) return setMessage({ ok: false, text: errorMessage(error) });
    applyView(null);
    setVersion((v) => v + 1);
  }

  const statuses = project.statuses;
  const visibleStatusIds = statuses.filter((s) => !state.hiddenStatusIds.includes(s.id)).map((s) => s.id);
  const visibleColumns = LIST_COLUMNS.filter((c) => !state.hiddenColumns.includes(c.id)).map((c) => c.id);
  const common = { state, activeKey: openRef, onOpen: (key: string) => open(key) };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Layout" className="flex rounded-md border border-border p-0.5">
          {LAYOUTS.map((l) => (
            <button
              key={l.value} role="tab" aria-selected={layout === l.value}
              onClick={() => setLayout(l.value)}
              className={cn("rounded px-3 py-1 text-sm", layout === l.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {l.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Saved views" value={applied?.id ?? ""} onChange={(e) => applyView(views.data?.find((v) => v.id === e.target.value) ?? null)}>
            <option value="">Default view</option>
            {views.data?.map((v) => <option key={v.id} value={v.id}>{v.scope === "SHARED" ? "🔗 " : ""}{v.name}</option>)}
          </Select>
          {applied && dirty && <Badge>modified</Badge>}
          {applied?.canEdit && dirty && <Button size="sm" variant="outline" onClick={() => void updateApplied()}>Update view</Button>}
          {applied?.canEdit && <Button size="sm" variant="ghost" onClick={() => void deleteApplied()}>Delete view</Button>}
          <Button size="sm" variant="outline" onClick={() => setSaving((v) => !v)}>Save view…</Button>
        </div>
      </div>

      {saving && (
        <form onSubmit={saveNew} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
          <Input name="name" required maxLength={60} placeholder="View name" aria-label="View name" className="w-56" />
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="shared" />Share with the project</label>
          <Button type="submit" size="sm">Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSaving(false)}>Cancel</Button>
        </form>
      )}
      {message && <Alert variant={message.ok ? "success" : "error"}>{message.text}</Alert>}

      {scrum && layout === "board" && state.filters.sprintId === "active" && <ActiveSprintBanner />}

      <FilterBar state={state} onChange={update} statuses={statuses} labels={project.labels} />

      {layout === "board" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Select aria-label="Swimlanes" value={state.swimlane} onChange={(e) => update({ ...state, swimlane: e.target.value as Swimlane })}>
            <option value="none">No swimlanes</option>
            <option value="assignee">Swimlanes: assignee</option>
            <option value="priority">Swimlanes: priority</option>
            <option value="epic">Swimlanes: epic</option>
          </Select>
          <MultiSelect
            className="w-48" placeholder="Columns" aria-label="Visible columns"
            options={statuses.map((s) => ({ id: s.id, label: s.name }))} value={visibleStatusIds}
            onChange={(ids) => update({ ...state, hiddenStatusIds: statuses.map((s) => s.id).filter((id) => !ids.includes(id)) })}
          />
          <MultiSelect
            className="w-48" placeholder="Card fields" aria-label="Card fields"
            options={CARD_FIELDS.map((c) => ({ id: c.id, label: c.label }))} value={state.cardFields}
            onChange={(ids) => update({ ...state, cardFields: ids })}
          />
        </div>
      )}
      {layout === "list" && (
        <div className="flex items-center gap-2 text-sm">
          <MultiSelect
            className="w-48" placeholder="Columns" aria-label="List columns"
            options={LIST_COLUMNS.map((c) => ({ id: c.id, label: c.label }))} value={visibleColumns}
            onChange={(ids) => update({ ...state, hiddenColumns: LIST_COLUMNS.map((c) => c.id).filter((id) => !ids.includes(id)) })}
          />
        </div>
      )}

      {layout === "list" && <TaskList {...common} projectId={project.id} />}
      {layout === "board" && <BoardView {...common} projectId={project.id} />}
      {layout === "calendar" && <CalendarView {...common} projectId={project.id} />}
      {layout === "timeline" && <TimelineView {...common} projectId={project.id} />}

      <TaskPanel taskRef={openRef} onClose={() => open(null)} onNavigate={(key) => open(key)} />
    </div>
  );
}
