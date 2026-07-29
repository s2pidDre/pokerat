# Pokerat

Pokerat is a lightweight poker-table companion for private games with friends. It tracks table sessions, cash-in and cash-out requests, session duration, finished-table history, and an all-time leaderboard.

## Current build

This version is browser-based and stores data in the current browser using `localStorage`. It does not yet include a shared database or cross-device synchronisation. Publish it only for interface testing until the database and server-side permissions are added.

## Run locally

1. Open the project folder in VS Code.
2. Install the **Live Server** extension if needed.
3. Right-click `index.html`.
4. Select **Open with Live Server**.

No package installation is required to run the app.

## First setup

On a fresh browser, Pokerat asks you to create the first administrator account:

- Choose an administrator name.
- Create a six-digit PIN.
- Confirm the PIN.

The first administrator can approve new registrations, reset PINs, suspend accounts, manage reports, clear activity, and perform a hard reset.

## Account flow

- New players register using a unique player name and six-digit PIN.
- New accounts remain **Waiting** until an administrator approves them.
- Administrators receive a centred, one-at-a-time approval queue.
- **Remember me** keeps an account signed in after the browser closes.
- Without **Remember me**, the login lasts only for the browser session.
- Administrators can approve, reject, suspend, restore, reset PINs, and delete accounts without table history.
- PINs are stored as salted SHA-256 hashes rather than readable values.

## Main features

- Create or join a private table using a table code.
- Start, cancel, and finish sessions.
- Live session timer with saved duration in History.
- Cash-in and cash-out request queues shown one at a time to the table creator.
- Automatic table-money updates after approvals.
- Final review before finishing a table.
- Final player result pop-ups.
- Global leaderboard calculated only from finished tables.
- Responsive desktop, tablet, and mobile layouts.
- Essential notification vibration on supported devices.
- Administrator account and data controls.

## Tests

Run the included tests with Node.js:

```bash
npm test
```

## GitHub Pages

The app uses hash-based routes, so it can be hosted as a static site. In the repository settings, open **Pages**, choose **Deploy from a branch**, then select the branch and root folder containing `index.html`.

## Important limitation

All users and table activity currently exist only in one browser. Registration approvals and notifications will not synchronise between separate devices until a database and realtime backend are added. Do not use this build as the authoritative record for real-money games.
