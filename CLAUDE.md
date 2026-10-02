# CLAUDE.md

OfflineMedsTrack: a medication reminder app with refill tracking. **No backend; all data stays on the device.**

## Stack

- React Native + Expo SDK 57 (managed workflow), TypeScript (strict)
- expo-router (file-based navigation), typed routes enabled
- expo-sqlite (local storage), expo-notifications (reminders)
- ESLint (flat config) + Prettier, Jest (`jest-expo`) + React Native Testing Library

Expo APIs change between SDKs. Check the docs for the installed SDK (`https://docs.expo.dev/versions/v57.0.0/`) before using an Expo API from memory.

## Folder structure

```
app/            expo-router routes only (screens and _layout files); keep thin
src/db/         SQLite setup, migrations, schema, and repository/query functions
src/features/   feature modules (e.g. medications, reminders, refills): components, hooks, logic
src/components/ shared, feature-agnostic UI components
src/lib/        shared utilities (dates, notification helpers, etc.)
__tests__/      tests (do not put tests under app/, they would become routes)
```

Path alias: `@/*` maps to `src/*` (e.g. `import { db } from '@/db/client'`).

## Today screen and dose logging (`src/features/today`, `doses`, `settings`)

- Tabs live in `app/(tabs)`: Today (home, `index`), Medications (`meds`), Settings. Detail/edit/new routes are Stack screens above the tabs.
- **All dose state changes go through `setDoseState` (`src/features/doses/state.ts`)** (via `takeDose`/`skipDose`/`snoozeDose`/`logAsNeededDose`/`undoDose` in `doseActions.ts`). It adjusts inventory in the same transaction: only a _taken_ dose consumes supply (by the logged quantity); skipped, missed and snoozed never do; changing or undoing a taken dose gives it back. Never call `recordDose` or `adjustInventoryQuantity` directly for logging.
- `timeline.ts` is pure: builds the day's doses, effective status (upcoming/overdue/snoozed/taken/skipped/missed), grouping, and the as-needed list. `missed.ts` persists "missed" once the configurable window (setting `missedAfterMinutes`, default 120) elapses; it runs whenever Today loads, on a 60 s refresh, and on foreground. Doses scheduled before a schedule was last edited are never marked missed.
- **Supply never goes below zero.** `setDoseStateDetailed` records `supply_used` (what was actually deducted, migration 004) and returns a `shortfall`; callers (`takeDose`, history edits) surface it via `shortfallMessage` / `SupplyWarning`. Undo/edit give back exactly what was used.
- **Schedule edits and logged doses:** `coveredSlotKeys` (`timeline.ts`) lets a taken/skipped log whose time was edited away stand in for the nearest unlogged slot of that medication and day, so the day's dose is never shown, reminded about, or marked missed twice. It is applied in the timeline, the missed sweep, History and `reconcile`: use it for any new code that expands slots against logs. `schedules.updated_at` only changes when the dose _timing_ changes (times, days, interval, start date, type), because it is the floor for expected doses.
- As-needed doses are logged with `scheduledFor` = the time taken (no schedule slot).
- Settings are key/value rows (`settings` table, migration 002); use `getSettings`/`updateSettings` in `src/features/settings/settings.ts`.

## Settings, onboarding, lock, backup (`src/features/settings|onboarding|lock|backup`)

- `settings.ts` is the single typed view of the key/value `settings` table (`parseSettings` falls back to defaults; `updateSettings` validates). `SettingsProvider` (root layout) holds the live values and applies side effects: theme via `Appearance.setColorScheme`, 12/24-hour via `setTimeFormatPreference` in `lib/format`, snooze label via `setupNotifications`, and `syncReminders` when sound changes. Read settings in screens with `useSettings()`; never cache them elsewhere. Snooze length and sound are read from the DB inside `snoozeDose` / `reconcile`, so background handlers honour them. Notification sound is part of the pending-notification key (reminders are rescheduled when it changes) and silent reminders use their own Android channel.
- `appLock` and `onboardingComplete` are device-specific: never back up or restore them (`DEVICE_ONLY_SETTINGS`, `BACKUP_SETTING_KEYS`). First run is gated in `app/(tabs)/_layout.tsx` (redirects to `/onboarding`). Always show `DisclaimerCard` (not medical advice) in onboarding and Settings.
- App lock: `AppLockGate` (root) locks at launch and after >= 30 s in the background, and covers the app while inactive. Biometrics sit behind `AuthPort` (`lock/auth.ts`); changing the lock requires authenticating (`confirmLockChange`). The device passcode is allowed as a fallback so a broken sensor can't lock someone out.
- Backup: `src/db/backup.ts` owns the table specs (`BACKUP_TABLES`); **adding a table or column in a new migration means updating it** (and the schema version in a backup is the migration count). `parseBackup` validates everything before any change (format, version: newer refused, older accepted with missing tables empty; column types; duplicates; foreign keys); `restoreBackup` replaces all data in one transaction and rolls back on any failure. Files are plain, unencrypted JSON: keep the privacy warning in the UI. Pickers/exporters go through `BackupPicker` / `FileExporter` so tests use fakes.

## History (`src/features/history`)

- Tabs: Today, History, Medications, Refills, Settings. `adherence.ts` (pure) builds per-day records (`buildDayStats`) and 7/30/90-day adherence. Expected doses come from active schedules, only up to now, and never before a schedule's `updatedAt` unless logged; unlogged doses past the missed window count as missed; **skipped counts as not taken**; late doses count as taken; as-needed doses are listed but never counted.
- Editing/backfilling past logs goes through `historyActions.ts`, which uses `setDoseState` / `moveDose` (atomic delete+create for changing an as-needed dose's time, its key), so inventory follows every edit. Never write dose logs from history code directly. Clearing a dose inside the missed lookback lets the Today sweep re-mark it missed.
- Export: `csv.ts` / `pdf.ts` are pure (CSV escapes quotes/newlines and neutralises `= + - @` formulas; HTML escapes all user text). Device access (`expo-print`, `expo-file-system`, `expo-sharing`) is only in `exporter.ts` behind the `FileExporter` interface; `exportHistory()` orchestrates and tests use a fake exporter.

## Refills and supply (`src/lib/supply.ts`, `src/features/refills`)

- `projectSupply()` (pure) simulates dose by dose from today, so weekday-only and every-N-days schedules are exact; run-out date = the first dose the supply can't cover, `daysRemaining` = whole days until then (0 = today). As-needed medications use their average use over the last 30 days (`asNeededPerDay`, loaded by `refills/usage.ts`), or have no estimate. Use `buildSummary()` (`features/medications/summary.ts`) rather than calling the helpers piecemeal; `isLowSupply` is inclusive.
- Refill reminders are planned by `refills/planner.ts` (pure) and scheduled by `reconcile()` like dose reminders (ids `refill:{med}:1|2|doctor`). Per low-supply episode at most two reminders: next 09:00 after the episode starts, and 09:00 two days later if still unresolved; times already in the past are never re-planned. An episode ends only when quantity rises above the lowest seen (a refill). When `refillsRemaining` is 0 one "contact your doctor" reminder is planned (folded into the low-supply text if supply is also low). Episode state lives in the `refill_alerts` table (migration 003); reconcile maintains it.
- Record refills only through `saveRefill()` (`refills/data.ts`), which wraps the atomic `recordRefill` repo function (inventory + refillsRemaining - 1 + RefillEvent) and then syncs reminders.
- Refills tab is sorted by `buildRefillList`.

## Dose reminders (`src/features/reminders`)

- `reconcile()` in `reconcile.ts` is the **only** code that schedules or cancels dose notifications. It derives the desired set from the DB (active schedules, rolling 7-day window, minus doses already taken/skipped), diffs against what the OS has pending, cancels stale and schedules missing. Never schedule or cancel notifications anywhere else.
- Call `syncReminders(db)` after any change to medications, schedules, or dose logs; it is best-effort and never throws. It also runs on launch and when the app returns to the foreground (`useReminderLifecycle`).
- `planner.ts` is pure (no Expo imports); doses are computed from local wall-clock times in the device's current zone, so a zone/DST change is fixed by the next reconcile. Notification ids are deterministic: `dose:{medId}:{scheduledFor}` and `snooze:{medId}:{scheduledFor}`.
- `actions.ts` handles Taken / Snooze / Skip and is idempotent. Expo is reached only through `NotificationsPort` (`ports.ts`, adapter in `expoPort.ts`), so logic is tested with `__tests__/helpers/fakePort.ts`.
- Reminders only cover a rolling window (and at most 56 doses), so after the last scheduled reminder `reconcile` adds one `nudge:` notice ("Keep your reminders going") if more doses are due later; opening the app reconciles again. Delivered reminders for deleted/paused medications are dismissed (`port.listPresented`), and a button tapped for a deleted medication is ignored. A time zone change while the app is closed can't be detected until the app is next opened (managed Expo has no hook for it).
- iOS allows 64 pending notifications; `MAX_SCHEDULED_DOSES` (56) leaves headroom for snoozes.

## Accessibility

- Buttons that repeat on a screen (Taken, Edit, Undo, Record refill, ...) must pass `accessibilityLabel` with context (e.g. `Taken, Metformin 8:00 AM`) that still starts with the visible label. `__tests__/a11y/screens.test.tsx` fails if any control is unnamed or two buttons on a screen share a name; `contrast.test.ts` checks every text/background pair of both palettes against WCAG AA (add new color pairs there). Information is never color alone (symbols, text labels). Time-limited UI (Undo bar) stays until dismissed for screen-reader users. Large text: layouts must grow, not clip (`MonthCalendar` stacks and caps font growth in its dense grid).

## Conventions

- TypeScript `strict` is on. **No `any`** (enforced by ESLint); use `unknown` and narrow, or proper types.
- Functional components with hooks only; no class components.
- Route files in `app/` compose feature components; business logic lives in `src/features` and `src/lib`.
- All database access goes through `src/db`; screens and components never run SQL directly.
- Schema changes require a new migration, never an edit to a shipped one.
- Add packages with `npx expo install <pkg>` so versions match the SDK (if the Expo API is unreachable, use the versions in `node_modules/expo/bundledNativeModules.json` with `npm install`).
- Format with Prettier (single quotes, trailing commas, 100 cols). Run lint, typecheck, and tests before finishing a task.
- Tests that change the time zone use `withTimeZone` from `__tests__/helpers/fakePort.ts` (Jest's `process.env` is sandboxed; plain assignment has no effect).
- Write tests with React Native Testing Library; note that its `render` and `fireEvent` are async in this version, so `await` them.

## Commands

```bash
npm install            # install dependencies
npm start              # start Expo dev server (also: npm run android / ios)
npm test               # run Jest (npm run test:watch for watch mode)
npm run lint           # ESLint (npm run lint:fix to autofix)
npm run format         # Prettier write (npm run format:check to verify)
npm run typecheck      # tsc --noEmit
```

Notifications are unreliable in Expo Go (especially on Android); use a development build for notification work.
