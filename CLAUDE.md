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

## Conventions

- TypeScript `strict` is on. **No `any`** (enforced by ESLint); use `unknown` and narrow, or proper types.
- Functional components with hooks only; no class components.
- Route files in `app/` compose feature components; business logic lives in `src/features` and `src/lib`.
- All database access goes through `src/db`; screens and components never run SQL directly.
- Schema changes require a new migration, never an edit to a shipped one.
- Add packages with `npx expo install <pkg>` so versions match the SDK (if the Expo API is unreachable, use the versions in `node_modules/expo/bundledNativeModules.json` with `npm install`).
- Format with Prettier (single quotes, trailing commas, 100 cols). Run lint, typecheck, and tests before finishing a task.
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
