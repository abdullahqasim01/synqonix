import type { MessageDto } from './dto/channels.dto.js';

/** Events other modules emit that the chat module reacts to. */
export const ProjectEvents = {
  created: 'project.created',
  updated: 'project.updated',
  memberChanged: 'project.member_changed',
} as const;

export const WorkspaceEvents = {
  memberRemoved: 'workspace.member_removed',
} as const;

export interface ProjectCreatedEvent {
  workspaceId: string;
  projectId: string;
  key: string;
  name: string;
  visibility: 'WORKSPACE' | 'PRIVATE';
  memberIds: string[];
}

export interface ProjectUpdatedEvent {
  workspaceId: string;
  projectId: string;
  name: string;
  visibility: 'WORKSPACE' | 'PRIVATE';
}

export interface ProjectMemberChangedEvent {
  workspaceId: string;
  projectId: string;
  userId: string;
  /** `null` when the member was removed. */
  role: 'ADMIN' | 'MEMBER' | 'VIEWER' | null;
}

export interface WorkspaceMemberRemovedEvent {
  workspaceId: string;
  userId: string;
}

/** Events the chat module emits; the realtime gateway turns them into socket messages. */
export const ChatEvents = {
  message: 'chat.message',
  member: 'chat.member',
  read: 'chat.read',
  channelsChanged: 'chat.channels_changed',
  mentioned: 'chat.mentioned',
  /** Who may see a channel changed in a way the member list does not capture (e.g. its project went private). */
  accessChanged: 'chat.access_changed',
} as const;

export interface ChatAccessChangedEvent {
  channelId: string;
}

export interface ChatMessageEvent {
  type: 'created' | 'updated' | 'deleted' | 'reactions';
  workspaceId: string;
  channelId: string;
  /** Without per-viewer data (`reacted`, resolved task cards). */
  message: MessageDto;
}

export interface ChatMemberEvent {
  type: 'added' | 'removed';
  workspaceId: string;
  channelId: string;
  userId: string;
}

export interface ChatReadEvent {
  userId: string;
  channelId: string;
  seq: number;
}

export interface ChatChannelsChangedEvent {
  workspaceId: string;
  /** Notify only these users; everyone in the workspace when omitted. */
  userIds?: string[];
}

/** Consumed by notifications (phase 8). */
export interface ChatMentionedEvent {
  workspaceId: string;
  channelId: string;
  messageId: string;
  actorId: string;
  mentionedUserIds: string[];
}
