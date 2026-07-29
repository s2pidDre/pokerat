# Pokerat Supabase setup

Complete these steps on the `database-realtime` Git branch.

## 1. Authentication setting

In Supabase Dashboard:

```text
Authentication
→ Providers
→ Email
```

Keep Email enabled. For initial testing, turn **Confirm email** off.

## 2. Create the database schema

1. Open **SQL Editor**.
2. Click **New query**.
3. Open `supabase/schema.sql` from this project.
4. Copy the entire file into the SQL Editor.
5. Click **Run** once.

A successful run creates the `profiles` table, account rules, first-admin setup, Row Level Security and the realtime publication.

## 3. Deploy `username-login`

1. Open **Edge Functions**.
2. Click **Deploy a new function**.
3. Choose **Via Editor**.
4. Name it exactly:

```text
username-login
```

5. Replace the editor contents with `supabase/functions/username-login/index.ts`.
6. Turn **Verify JWT** off for this function because it is used before login.
7. Deploy it.

## 4. Deploy `admin-account`

1. Create another Edge Function through the editor.
2. Name it exactly:

```text
admin-account
```

3. Replace the editor contents with `supabase/functions/admin-account/index.ts`.
4. Keep **Verify JWT** on.
5. Deploy it.

The functions use Supabase's built-in server environment variables. Do not paste a service-role key into the code.

## 5. Clear the old local prototype data

Because Supabase uses UUID account IDs, old browser-only accounts and their local test tables are not migrated.

In the browser where you tested the old local build:

1. Open Developer Tools with `F12`.
2. Open **Application**.
3. Open **Storage**.
4. Click **Clear site data**.
5. Reload Pokerat.

The first screen should be **Create administrator**.

## 6. Test the complete account flow

1. Create the first administrator.
2. Open Pokerat in another browser or Incognito window.
3. Register a normal account.
4. Keep the new account on the Waiting screen.
5. Return to the administrator browser.
6. The approval request should appear without refreshing.
7. Approve it.
8. The Waiting screen should change automatically.
9. Log out and verify both username login and email login.
10. Test Remember Me by closing and reopening the browser.

## 7. Commit to GitHub

After testing in GitHub Desktop:

```text
Summary: Connect Supabase authentication and realtime account approval
Commit to database-realtime
Push origin
```

Do not merge into `main` until the account flow works on two separate browser sessions.
