/// <reference types="node" />
import type {
  NotificationRequest,
  NotificationsPort,
  PendingNotification,
  PermissionState,
} from '@/features/reminders/ports';

/** In-memory stand-in for the OS notification scheduler. */
export class FakePort implements NotificationsPort {
  permission: PermissionState = 'granted';
  pending = new Map<string, NotificationRequest>();
  dismissed: string[] = [];
  /** Delivered notifications still in the shade (see `listPresented`). */
  presented: { identifier: string; medicationId: number | null }[] = [];
  scheduleCalls = 0;
  cancelCalls = 0;

  async getPermissionState() {
    return this.permission;
  }

  async listPending(): Promise<PendingNotification[]> {
    return [...this.pending.values()].map((r) => ({
      identifier: r.identifier,
      content: typeof r.data.content === 'string' ? r.data.content : null,
    }));
  }

  async listPresented() {
    return [...this.presented];
  }

  async schedule(request: NotificationRequest) {
    this.scheduleCalls++;
    this.pending.set(request.identifier, request);
  }

  async cancel(identifier: string) {
    this.cancelCalls++;
    this.pending.delete(identifier);
  }

  async dismiss(identifier: string) {
    this.dismissed.push(identifier);
    this.presented = this.presented.filter((p) => p.identifier !== identifier);
  }

  /** Pending dose reminders as local wall-clock strings, e.g. `2026-06-10 20:00`. */
  localTimes(): string[] {
    return [...this.pending.values()]
      .filter((r) => r.identifier.startsWith('dose:'))
      .map((r) => r.fireAt)
      .sort((a, b) => a.getTime() - b.getTime())
      .map(localString);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

export const localString = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Jest gives tests a sandboxed copy of `process.env`; changing the zone must reach the real process.
const realProcess = process.getBuiltinModule('node:process');

/** Runs `fn` with the process time zone temporarily set to `zone` (Node re-reads TZ on assignment). */
export async function withTimeZone<T>(zone: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = realProcess.env.TZ;
  realProcess.env.TZ = zone;
  try {
    return await fn();
  } finally {
    realProcess.env.TZ = previous;
  }
}
