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
