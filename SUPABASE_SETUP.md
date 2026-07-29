# Pokerat Supabase realtime table setup

The authentication schema and both Edge Functions should already exist. Complete the steps below on the `database-realtime` Git branch.

## 1. Install the shared table schema

In Supabase Dashboard:

```text
SQL Editor
→ New query
```

Open this repository file:

```text
supabase/table-system.sql
```

Copy the entire file into the SQL Editor and click **Run**.

This creates the shared database for:

- Poker tables
- Table members
- Cash-in and cash-out requests
- Transactions
- Notifications
- Closed-session results
- Reports
- Audit logs
- Atomic table actions
- Row Level Security
- Realtime publications

The file is written to be rerunnable if the first attempt is interrupted.

## 2. Redeploy `admin-account`

The Admin function now clears shared table activity before Hard Reset deletes accounts.

Open:

```text
Edge Functions
→ admin-account
```

Replace its code with:

```text
supabase/functions/admin-account/index.ts
```

Deploy it again and keep **Verify JWT On**.

The existing `username-login` function does not need to change.

## 3. Refresh Pokerat

Restart Live Server and press:

```text
Ctrl + F5
```

Old browser-only table activity is ignored. Your real Supabase accounts remain.

## 4. Test with two sessions

Use one normal browser window for the table creator and one Incognito window for another approved account.

Test in this order:

1. Create a table in the normal window.
2. Copy the table code.
3. Join it in Incognito.
4. Confirm both screens update without refreshing.
5. Start the table.
6. Submit a cash-in request from Incognito.
7. Confirm the centred host approval queue appears automatically.
8. Approve it and confirm table money updates on both screens.
9. Submit and decide a cash-out request.
10. Close the table.
11. Confirm the final result, History, duration and Leaderboard update on both accounts.

## 5. Check Realtime if updates do not appear

In Supabase, open:

```text
Database
→ Publications
→ supabase_realtime
```

Confirm these tables are enabled:

```text
poker_tables
table_members
money_requests
transactions
notifications
session_results
session_reports
audit_logs
```

The SQL normally enables them automatically.

## 6. Commit after testing

In GitHub Desktop:

```text
Summary: Move poker tables and notifications to Supabase realtime
Commit to database-realtime
Push origin
```

Keep `main` unchanged until the complete two-account workflow passes.


## Updating the table rules

Re-run `supabase/table-system.sql` after applying this update. It adds the single globally open table rule, makes the open table discoverable to every approved account, and keeps closed-table history private to participants and administrators.
