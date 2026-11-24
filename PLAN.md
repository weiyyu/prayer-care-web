# Prayer Care Web rollout

## Scope

The first web version covers prayer people, requests, visits, and prayer cards. Bible verses, RAA, letters, widgets, and phone watch are separate later decisions. The Android project remains untouched.

## Model

- One `care_people` record per person or group. `is_profiled` distinguishes a full care file from a lightweight prayer name; category belongs to the person.
- A person has many `prayer_items`. Each is `active`, `prayed`, or `answered`; answered items keep date and testimony note.
- A profiled person has many `care_visits`, each with date, place, family, work, spiritual, and prayer notes. A database trigger creates/updates a linked prayer request when a visit includes a prayer note.
- Photos live in a private storage bucket under the signed-in user's folder. The database stores only the object path.

## Stages

1. **Foundation (this pass):** independent project, responsive interface, in-memory demo, account sign-in adapter, schema/RLS/private storage, core create/edit/read workflows.
2. **Cloud proof:** the connected project's RLS policy and anon grants have been audited, and anonymous REST reads returned 401 on all three app tables. Remaining: run `supabase/tests/tenant_isolation_test.sql` on a disposable local stack; use two disposable cloud accounts to prove read/write isolation and verify private-photo access, sign-out, and token expiry. A read-only two-account runner is prepared as `npm run test:isolation`; cross-account checks are still pending until both accounts contain fictional test rows.
3. **Migration:** define Android JSON export mapping, preview counts and conflicts, and only then import with confirmation. No implicit sync or overwrite.
4. **Release:** deletion/export controls, backup/restore procedure, privacy/legal review, monitoring, and mobile browser testing. A web app is not a replacement for the Android phone-watch or home-screen widgets.

## Security acceptance

- `owner_id` is enforced by RLS on every table and by composite foreign keys between a person's related rows.
- Unauthenticated requests read and write nothing. No service key is shipped to the browser.
- The photo bucket is private; listing, upload, update, delete, and authenticated downloads are restricted to the owner's folder.
- Test with two different accounts before real data. A demo screenshot or a single-account test is not proof of isolation.
- The Supabase Free plan does not include automatic daily database backups. An off-site export schedule covering both database records and photo objects, plus a restore rehearsal, is required before public release. The free-tier quota and inactivity policy must be checked before inviting more users.
