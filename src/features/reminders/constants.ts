export const DOSE_CHANNEL_ID = 'doses';
/** Android channel sounds can't be changed after creation, so silent reminders use their own. */
export const DOSE_SILENT_CHANNEL_ID = 'doses-silent';
export const DOSE_CATEGORY_ID = 'dose';

export const ACTION_TAKEN = 'dose.taken';
export const ACTION_SNOOZE = 'dose.snooze';
export const ACTION_SKIP = 'dose.skip';

/** Default snooze length; the person can change it in Settings. */
export const SNOOZE_MINUTES = 10;

/** How far ahead doses are scheduled. iOS keeps at most 64 pending local notifications. */
export const WINDOW_DAYS = 7;
/** Cap on scheduled doses; the headroom up to 64 is for snoozes and any future one-offs. */
export const MAX_SCHEDULED_DOSES = 56;

export const DOSE_ID_PREFIX = 'dose:';
export const SNOOZE_ID_PREFIX = 'snooze:';
/** A "open the app to keep your reminders going" notice after the last scheduled reminder. */
export const NUDGE_ID_PREFIX = 'nudge:';
