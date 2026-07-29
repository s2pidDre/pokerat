# Pokerat

Pokerat is a private poker-table companion for games with friends. It now uses Supabase for accounts, shared tables, cash-in and cash-out requests, transactions, notifications, finished-session history and the global leaderboard.

## Current realtime features

- Username or email + password login
- Administrator approval for new accounts
- Shared table creation and table-code joining
- Live member changes across devices
- One-at-a-time host cash-in/cash-out approval queue
- Automatic table-money calculations after approval
- Realtime approval and rejection notifications
- Session timer, closing review and saved duration
- Finished-table History
- Global Leaderboard calculated only from closed tables
- Realtime final-result pop-ups
- Remote reports and audit records
- Admin Clear Activity and Hard Reset

## Setup

Complete `SUPABASE_SETUP.md` before testing this branch.

## Run locally

1. Open the repository folder in VS Code.
2. Right-click `index.html`.
3. Choose **Open with Live Server**.
4. Open a normal browser and an Incognito browser to test two accounts.
5. Refresh using `Ctrl + F5` after replacing files.

The browser loads `supabase-js` from jsDelivr, so an internet connection is required.

## Supabase files

```text
supabase/
├── schema.sql
├── table-system.sql
├── config.toml
└── functions/
    ├── username-login/
    │   └── index.ts
    └── admin-account/
        └── index.ts
```

Frontend services:

```text
src/lib/
├── supabase.js
├── account-service.js
└── table-service.js
```

The publishable key in `src/lib/supabase.js` is browser-safe. Never add a database password, secret key or `service_role` key to the frontend or GitHub.

## Tests

```bash
npm test
```
