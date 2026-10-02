# OfflineMedsTrack

A medication reminder app with refill tracking, built with React Native and Expo. There is no backend: all data is stored locally on the device in SQLite.

## Stack

React Native (Expo managed workflow), TypeScript, expo-router, expo-sqlite, expo-notifications, Jest + React Native Testing Library, ESLint, Prettier.

## Prerequisites

- Node.js 20+ and npm
- An iOS/Android device or emulator. [Expo Go](https://expo.dev/go) works for basic development, but local notifications are limited there (especially on Android), so use a [development build](https://docs.expo.dev/develop/development-builds/introduction/) when working on reminders.

## Setup

```bash
git clone <repo-url>
cd offlinemedstrack
npm install
npm start
```

Then press `i` (iOS simulator), `a` (Android emulator), or scan the QR code with Expo Go.

## Scripts

| Command                | Description                |
| ---------------------- | -------------------------- |
| `npm start`            | Start the Expo dev server  |
| `npm test`             | Run unit/component tests   |
| `npm run lint`         | Lint with ESLint           |
| `npm run format`       | Format with Prettier       |
| `npm run format:check` | Check formatting           |
| `npm run typecheck`    | Type-check with TypeScript |

## Project structure

```
app/            expo-router routes
src/db/         SQLite setup and queries
src/features/   feature modules
src/components/ shared UI components
src/lib/        shared utilities
__tests__/      tests
```

See [CLAUDE.md](./CLAUDE.md) for coding conventions.

## Today screen

The home tab lists today's doses grouped by time of day (or exact time, see Settings). Each dose has a one-tap **Taken** button, plus **Skip**, **Snooze 10 min** and **Different time or quantity** under _More options_. Overdue doses are highlighted and labelled; a dose with no action after the missed window (default 2 hours, configurable in Settings) is recorded as **Missed**. As-needed medications have their own section for logging a dose at any time. Every change can be undone from the bar that appears after it or from the dose itself.

Logging a dose as taken reduces your supply by the quantity taken; skipped and missed doses do not, and undoing a taken dose gives the supply back.

## First run, settings, privacy and backup

- **Onboarding:** on first launch the app explains what it does, shows that it is a reminder tool and not medical advice, asks for notification permission (after explaining why; denying is fine), and offers to add your first medication. You can also restore a backup there.
- **Settings:** missed-dose window, default snooze length, default low-supply warning for new medications, notification sound on/off, 12/24-hour time, light/dark/match-phone theme, and grouping on the Today screen. The not-medical-advice notice is also shown in Settings.
- **App lock (optional):** ask for Face ID, a fingerprint or the phone passcode when opening the app, and after it has been in the background for 30 seconds. The app also hides its contents in the app switcher while locked. Turning it on or off needs you to authenticate. Medication names can still appear in notifications on the lock screen.
- **Backup and restore:** _Export backup_ saves all medications, schedules, dose history, supply and refills (and your preferences) to one JSON file through the share sheet. _Restore from backup_ replaces everything in the app with a backup file after you confirm. Files from a newer version of the app are refused; older ones are accepted. A damaged file is rejected before anything changes. The file is not encrypted and contains health information, so keep it somewhere private. App lock and first-run state stay specific to each phone.

## History

The **History** tab shows a calendar where each day is colored (and marked with a symbol and spoken label) as all doses taken, some missed, none taken, or nothing scheduled. Tap a day to see its log. If you took a dose but forgot to record it, tap **Edit** to mark it taken (with the time and quantity), skipped, missed, or not recorded; you can also add, change or delete as-needed doses. Supply is adjusted to match every edit, and each change has an Undo.

Adherence per medication over 7, 30 and 90 days is taken doses divided by doses due; skipped and missed doses count as not taken, late doses count as taken, and as-needed medications show a dose count instead of a percentage. **Share with your doctor** exports the last 30 or 90 days, or all history, as a CSV or PDF through your phone's share sheet. Nothing is sent anywhere until you pick a destination. (Manual check on a device: export both formats and open them from the share target.)

## Refill tracking

Supply is projected from your schedule: weekday-only and every-N-days schedules are counted exactly, and as-needed medications use your average over the last 30 days. The medication list shows a supply indicator, the detail screen shows the estimated run-out date, and the **Refills** tab lists every medication by soonest run-out date.

When supply reaches your refill threshold you get a reminder at 9:00 the next morning, and one more two days later if it is still unresolved (never more than two per low-supply period). If a prescription has no refills left you get a single reminder to contact your doctor. **Record refill** adds the quantity, the date and an optional note, uses up one remaining refill, and keeps a history. **Call pharmacy** dials the number stored with the medication (add it under Edit).

## Reliability notes

- Reminders are scheduled a few days ahead and refreshed whenever you open the app. They survive restarts and app updates, and the app repairs anything the system lost the next time it opens. If you don't open the app for a long time the scheduled reminders run out; a notice arrives after the last one asking you to open the app.
- If you change time zones while the app is closed, reminders keep their old absolute times until you next open the app, which moves them to the same local times.
- If a dose is larger than the supply the app has recorded, supply stops at zero and you are warned to check the count.
- Editing a medication's times after logging a dose does not make that dose appear twice.

## Dose reminders

Reminders are local notifications; nothing leaves the device. Use a **development build** to test them (`npx expo run:android` / `run:ios`); Expo Go is unreliable for notifications.

- The app explains why it needs notification permission before showing the system prompt. If permission is denied, the medication list shows how to enable it later in the system Settings.
- A rolling 7-day window of doses is scheduled (iOS allows only 64 pending notifications) and refreshed on launch, on returning to the foreground, and after any medication or schedule change.
- Notification buttons: **Taken**, **Snooze 10 min**, **Skip**. On Android they are recorded without opening the app. On iOS they open the app, because iOS does not run app code for a button tap when the app has been force-quit.
- Doses fire at the wall-clock time you chose, including across daylight saving changes. If the device time zone changes while the app is closed, reminders are corrected the next time the app is opened.

### Manual test checklist (needs a device)

1. Add a medication: the explanation screen appears, then the system prompt.
2. Deny the prompt: the list shows "Reminders are off" with an **Open Settings** button.
3. Allow, set a dose a couple of minutes ahead: tap Taken / Snooze / Skip from the notification and check the medication's history.
4. Change the device time zone, reopen the app: reminders move to the same local times.
