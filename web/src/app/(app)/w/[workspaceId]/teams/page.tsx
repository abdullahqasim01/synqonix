"use client";

import { useState } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Input, Select } from "@/components/ui/form";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { useQuery } from "@/lib/use-query";

function TeamCard({ team, people, reload }: { team: Schemas["TeamDto"]; people: Schemas["MemberDto"][]; reload: () => void }) {
  const { workspace, isAdmin } = useWorkspace();
  const path = { workspaceId: workspace.id, teamId: team.id };
  const inTeam = new Set(team.members.map((m) => m.userId));

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const userId = String(new FormData(e.currentTarget).get("userId"));
    await api.POST("/api/v1/workspaces/{workspaceId}/teams/{teamId}/members", { params: { path }, body: { userId } });
    reload();
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{team.name}</h2>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => confirm(`Delete team ${team.name}?`) && void api.DELETE("/api/v1/workspaces/{workspaceId}/teams/{teamId}", { params: { path } }).then(reload)}>
            Delete
          </Button>
        )}
      </div>
      {team.description && <p className="text-sm text-muted-foreground">{team.description}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {team.members.map((m) => (
          <Badge key={m.userId} className="gap-1">
            {m.name}
            {isAdmin && (
              <button aria-label={`Remove ${m.name} from ${team.name}`} className="text-muted-foreground hover:text-foreground"
                onClick={() => void api.DELETE("/api/v1/workspaces/{workspaceId}/teams/{teamId}/members/{userId}", { params: { path: { ...path, userId: m.userId } } }).then(reload)}>×</button>
            )}
          </Badge>
        ))}
        {team.members.length === 0 && <span className="text-sm text-muted-foreground">No members yet.</span>}
      </div>
      {isAdmin && (
        <form onSubmit={add} className="mt-3 flex gap-2">
          <Select name="userId" aria-label={`Add to ${team.name}`} required defaultValue="">
            <option value="" disabled>Add a person…</option>
            {people.filter((p) => !inTeam.has(p.userId)).map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
          </Select>
          <Button type="submit" size="sm">Add</Button>
        </form>
      )}
    </Card>
  );
}

export default function TeamsPage() {
  const { workspace, isAdmin } = useWorkspace();
  const path = { workspaceId: workspace.id };
  const teams = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/teams", { params: { path } }), [workspace.id]);
  const people = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/members", { params: { path } }), [workspace.id]);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/teams", { params: { path }, body: { name: String(new FormData(form).get("name")) } });
    setError(error ? errorMessage(error) : null);
    if (!error) form.reset();
    teams.reload();
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
      {error && <Alert>{error}</Alert>}
      {isAdmin && (
        <form onSubmit={create} className="flex max-w-sm gap-2">
          <Input name="name" placeholder="New team, e.g. Backend" required maxLength={60} aria-label="Team name" />
          <Button type="submit">Create</Button>
        </form>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {teams.data?.map((t) => <TeamCard key={t.id} team={t} people={people.data ?? []} reload={teams.reload} />)}
      </div>
      {teams.data?.length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
    </div>
  );
}
