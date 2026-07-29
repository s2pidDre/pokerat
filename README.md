# Pokerat

Pokerat is a lightweight poker-table companion for private games with friends. It tracks table sessions, cash-in and cash-out requests, session duration, finished-table history, and an all-time leaderboard.

## Current build

This version is browser-based and stores data in the current browser using `localStorage`. It does not yet include a shared Supabase database or cross-device realtime synchronisation.

## Run locally

1. Open the project folder in VS Code.
2. Install the **Live Server** extension if needed.
3. Right-click `index.html`.
4. Select **Open with Live Server**.

No package installation is required to run the app.

## Account flow

- Registration uses **username, email, password, and confirm password**.
- Login accepts **username or email** plus password.
- Usernames contain 3–20 letters, numbers, or underscores.
- Passwords contain 8–64 characters.
- New accounts remain **Waiting** until an administrator approves them.
- The first launch asks the owner to create the first administrator account.
- **Remember me** keeps an account signed in after the browser closes.
- Administrators can approve, reject, suspend, restore, reset passwords, and delete accounts without table history.
- Passwords are stored locally as salted hashes in this prototype, not as readable text.

Existing local PIN-based accounts are migrated. After logging in once with the old PIN, the user must add an email address and create a new password.

## Supabase migration plan

This account layout matches Supabase email/password authentication much more closely:

- Supabase Auth will own the real email/password account.
- The Pokerat `profiles` table will store the unique username, display name, approval status, and administrator flag.
- Email login can use Supabase directly.
- Username login will be resolved securely through a server-side function before sign-in; the public browser must not expose a username-to-email directory.
- Account approval remains a separate Pokerat profile status after authentication.
- Realtime database subscriptions will later replace local browser-only notifications.

The current package is **Supabase-ready in interface and data shape**, but it is not connected to Supabase yet.

## Main features

- Create or join a private table using a table code.
- Start, cancel, and finish sessions.
- Live session timer with saved duration in History.
- Cash-in and cash-out request queues shown one at a time.
- Automatic table-money updates after approvals.
- Final review before finishing a table.
- Final player result pop-ups.
- Global leaderboard calculated only from finished tables.
- Responsive desktop, tablet, and mobile layouts.
- Essential notification vibration on supported devices.
- Administrator account and data controls.

## Tests

Run:

```bash
npm test
```

## Important limitation

All users and table activity currently exist only in one browser. Registration approvals and notifications will not synchronise between separate devices until Supabase and realtime subscriptions are added.
