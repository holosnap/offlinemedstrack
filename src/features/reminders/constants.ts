export const DOSE_CHANNEL_ID = 'doses';
export const DOSE_CATEGORY_ID = 'dose';

export const ACTION_TAKEN = 'dose.taken';
export const ACTION_SNOOZE = 'dose.snooze';
export const ACTION_SKIP = 'dose.skip';

export const SNOOZE_MINUTES = 10;

/** How far ahead doses are scheduled. iOS keeps at most 64 pending local notifications. */
export const WINDOW_DAYS = 7;
/** Cap on scheduled doses; the headroom up to 64 is for snoozes and any future one-offs. */
export const MAX_SCHEDULED_DOSES = 56;

export const DOSE_ID_PREFIX = 'dose:';
export const SNOOZE_ID_PREFIX = 'snooze:';
