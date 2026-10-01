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
