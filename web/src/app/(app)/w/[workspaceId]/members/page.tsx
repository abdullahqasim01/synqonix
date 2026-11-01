"use client";

import { useState } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, Field, Input, Select } from "@/components/ui/form";
import { api, errorMessage, type Schemas } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { ROLES, type WorkspaceRole } from "@/lib/permissions";
import { useQuery } from "@/lib/use-query";

export default function MembersPage() {
  const { workspace, isAdmin } = useWorkspace();
  const { user } = useAuth();
  const path = { workspaceId: workspace.id };
  const members = useQuery(() => api.GET("/api/v1/workspaces/{workspaceId}/members", { params: { path } }), [workspace.id]);
  const invites = useQuery(
    async () => (isAdmin ? api.GET("/api/v1/workspaces/{workspaceId}/invitations", { params: { path } }) : { data: [] as Schemas["InvitationDto"][] }),
    [workspace.id, isAdmin],
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Only owners may hand out the owner role.
  const assignable = ROLES.filter((r) => r !== "OWNER" || workspace.role === "OWNER");

  async function changeRole(userId: string, role: WorkspaceRole) {
    const { error } = await api.PATCH("/api/v1/workspaces/{workspaceId}/members/{userId}", { params: { path: { ...path, userId } }, body: { role } });
    setError(error ? errorMessage(error) : null);
    members.reload();
  }

  async function remove(userId: string) {
    const { error } = await api.DELETE("/api/v1/workspaces/{workspaceId}/members/{userId}", { params: { path: { ...path, userId } } });
    setError(error ? errorMessage(error) : null);
    members.reload();
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const email = String(f.get("email"));
    const { error } = await api.POST("/api/v1/workspaces/{workspaceId}/invitations", {
      params: { path }, body: { email, role: f.get("role") as WorkspaceRole },
    });
    setError(error ? errorMessage(error) : null);
    setInfo(error ? null : `Invitation sent to ${email}.`);
    if (!error) form.reset();
    invites.reload();
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
      {error && <Alert>{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      <Card>
        <ul className="divide-y divide-border">
          {members.data?.map((m) => {
            const self = m.userId === user?.id;
            const locked = m.role === "OWNER" && workspace.role !== "OWNER";
            return (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span>{m.name}{self && " (you)"} <span className="text-muted-foreground">{m.email}</span></span>
                <span className="flex items-center gap-2">
                  {isAdmin && !locked ? (
                    <Select aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => void changeRole(m.userId, e.target.value as WorkspaceRole)}>
                      {ROLES.filter((r) => assignable.includes(r) || r === m.role).map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
                    </Select>
                  ) : <Badge>{m.role.toLowerCase()}</Badge>}
                  {self ? (
                    <Button size="sm" variant="outline" onClick={() => confirm("Leave this workspace?") && void remove(m.userId)}>Leave</Button>
                  ) : isAdmin && !locked ? (
                    <Button size="sm" variant="outline" onClick={() => confirm(`Remove ${m.name}?`) && void remove(m.userId)}>Remove</Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {isAdmin && (
        <>
          <Card>
            <h2 className="mb-4 font-medium">Invite someone</h2>
            <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
              <Field label="Email" htmlFor="invite-email"><Input id="invite-email" name="email" type="email" required className="w-64" /></Field>
              <Field label="Role" htmlFor="invite-role">
                <Select id="invite-role" name="role" defaultValue="MEMBER">
                  {assignable.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
                </Select>
              </Field>
              <Button type="submit">Send invitation</Button>
            </form>
          </Card>

          {(invites.data?.length ?? 0) > 0 && (
            <Card>
              <h2 className="mb-4 font-medium">Pending invitations</h2>
              <ul className="divide-y divide-border">
                {invites.data?.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>{i.email} <Badge>{i.role.toLowerCase()}</Badge></span>
                    <span className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => void api.POST("/api/v1/workspaces/{workspaceId}/invitations/{invitationId}/resend", { params: { path: { ...path, invitationId: i.id } } }).then(invites.reload)}>Resend</Button>
                      <Button size="sm" variant="outline" onClick={() => void api.DELETE("/api/v1/workspaces/{workspaceId}/invitations/{invitationId}", { params: { path: { ...path, invitationId: i.id } } }).then(invites.reload)}>Revoke</Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
