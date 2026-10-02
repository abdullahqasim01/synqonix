/** Emitted after inbox changes so the realtime gateway can tell the user's open tabs to refetch. */
export const NotificationEvents = {
  created: 'notification.created',
  changed: 'notification.changed',
} as const;

export interface NotificationChangedEvent {
  userId: string;
}
