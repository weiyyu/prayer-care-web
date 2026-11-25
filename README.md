# Prayer Care Web

An independent web app for prayer requests, care profiles, visit journals, and prayer cards. The Android app in `../android_biblememory` is a reference only: this project does not import or modify its code, local database, or Google Drive backups.

## Run locally

1. Run `npm install` in this directory.
2. Run `npm run dev` and open the printed URL.
3. Without a Supabase configuration, the app opens in **demo mode** with fictional, in-memory records. Refreshing the page clears demo changes. Do not enter private information in demo mode.

## Connect personal accounts

1. Create a Supabase project under your own account.
2. For a new project, run `supabase/migrations/001_initial.sql`, then `supabase/migrations/002_prayer_checks.sql` in its SQL Editor. The first creates per-user tables, RLS policies, and a private photo bucket. The second adds owner-only daily prayer history and copies legacy `prayed` marks without deleting or changing existing prayers. Review both before running them. Photos are downloaded with the active login, not exposed through shareable signed URLs.
3. Copy `.env.example` to `.env.local` and fill in the project URL and **publishable/anon** key. Never put a service-role or secret key in the browser.
4. In Supabase Auth, enable Email sign-in and Confirm Email, then configure the site and redirect URLs for your deployment domain. The web app uses email/password registration and sign-in, plus email-based password recovery; it no longer uses magic-link sign-in.
5. For public registration, configure custom SMTP before inviting users. Supabase's built-in sender only reaches organization team addresses and has a low sending limit.
6. Restart the dev server. The app then requires sign-in and uses only the signed-in user's records.

A new cloud project is connected locally. On 2026-11-24, the remote database was audited: RLS is enabled on the original three app tables, each policy checks `owner_id = auth.uid()` for reads and writes, and `anon` has no SELECT/INSERT/UPDATE/DELETE table grants. Anonymous REST reads of those tables returned HTTP 401. This is a configuration and anonymous-access check, **not** proof of two-account isolation. Email/password registration, email confirmation, and sign-in have been completed with one account. Fictional profile, prayer, and visit records persisted after reload; visit-to-prayer synchronization, prayed/restore, answered-prayer preservation, search, and prayer cards worked in desktop and phone-sized layouts. These clearly labeled test records remain in the cloud account. Photo upload was attempted but not completed because Chrome's ChatGPT extension lacks local-file access. Cross-account isolation, private-photo access, and restore still need live tests before any real-data import or public deployment. The Supabase dashboard currently reports no backups. The Android backup format is intentionally not auto-imported; migration needs a separate preview, deduplication rules, and an explicit confirmation step. Migration 002 has not yet been applied to the connected cloud project, so the daily-history frontend must not be deployed there first.

## Checks

`npm run typecheck` and `npm run build` validate the frontend. `supabase/tests/tenant_isolation_test.sql` is prepared for `supabase test db` on a disposable local stack; it has **not** been run yet because Supabase CLI/Docker are not installed here. Cross-account RLS and private-photo access still need live tests with two disposable accounts before handling real pastoral data.

See [PLAN.md](PLAN.md) for the staged rollout and security acceptance criteria.
See [SETUP_zh-TW.md](SETUP_zh-TW.md) for the cloud setup and test checklist.
The read-only two-account check is prepared as `npm run test:isolation`; it needs two disposable, email-verified accounts configured in `.env.isolation.local` (never commit that file).
