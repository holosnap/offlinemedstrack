import type { UtcIso } from '@/lib/time';

export type PermissionState = 'granted' | 'undetermined' | 'denied';

export interface PendingNotification {
  identifier: string;
  /** Rendered title/body recorded when it was scheduled; used to detect edited medications. */
  content: string | null;
}

export interface NotificationRequest {
  identifier: string;
  title: string;
  body: string;
  fireAt: Date;
  data: Record<string, unknown>;
  /** Whether the notification plays a sound. */
  sound: boolean;
}

/** The slice of expo-notifications the reminder logic needs, so it can be tested with a fake. */
export interface NotificationsPort {
  getPermissionState(): Promise<PermissionState>;
  listPending(): Promise<PendingNotification[]>;
  schedule(request: NotificationRequest): Promise<void>;
  cancel(identifier: string): Promise<void>;
  /** Removes an already delivered notification from the notification shade. */
  dismiss(identifier: string): Promise<void>;
}

export interface DoseNotificationData extends Record<string, unknown> {
  medicationId: number;
  scheduledFor: UtcIso;
  quantity: number;
  sound: boolean;
  content: string;
}
