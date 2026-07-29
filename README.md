# Pokerat

Pokerat is a lightweight poker-table companion for private games with friends. It tracks table sessions, cash-in and cash-out requests, session duration, finished-table history, and an all-time leaderboard.

## Current migration stage

This branch uses **Supabase Auth and the Supabase `profiles` table** for:

- Username, email and password registration
- Username or email login
- Remember Me sessions
- First-administrator setup
- Administrator approval, rejection, suspension and restoration
- Administrator password reset and account deletion
- Realtime account-approval updates without refreshing

Poker tables, money requests, transactions, History and Leaderboard still use browser storage in this stage. They will be moved to Supabase after authentication has been tested successfully.

## Run locally

1. Complete `SUPABASE_SETUP.md` first.
2. Open the project folder in VS Code.
3. Right-click `index.html`.
4. Choose **Open with Live Server**.
5. Refresh with `Ctrl + F5` after replacing files.

The browser loads `supabase-js` from jsDelivr, so an internet connection is required.

## Account flow

- Registration uses **username, email, password and confirm password**.
- Login accepts **username or email** plus password.
- New accounts stay **Waiting** until an administrator approves them.
- The first launch creates the first administrator securely through Supabase.
- Pending users receive the approval change in realtime while the page is open.
- Regular users never see the Admin page.
- Supabase stores and verifies passwords; Pokerat does not store password hashes in browser data.

## Supabase files

```text
supabase/
├── schema.sql
├── config.toml
└── functions/
    ├── username-login/
    │   └── index.ts
    └── admin-account/
        └── index.ts
```

The frontend connection is configured in:

```text
src/lib/supabase.js
```

The included key is a browser-safe Supabase publishable key. Never add a database password, secret key or `service_role` key to the frontend or GitHub.

## Tests

Run:

```bash
npm test
```

## Important limitation

Account registration and approval work between separate devices in realtime after the Supabase setup is completed. Poker tables and money activity remain local to each browser until the next database migration stage.
