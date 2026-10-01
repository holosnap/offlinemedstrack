import { useReminderLifecycle } from './useReminderLifecycle';

/** Renders nothing; mounts the reminder lifecycle inside the database provider. */
export function ReminderLifecycle() {
  useReminderLifecycle();
  return null;
}
