-- Run with `supabase test db` against a disposable local Supabase stack only.
-- This transaction rolls back every fixture and write.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'prayer-test-a@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'prayer-test-b@example.invalid');

insert into public.care_people (id, owner_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Test A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'Test B');
insert into public.care_visits (id, owner_id, person_id, visit_date) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current_date);
insert into public.prayer_items (id, owner_id, person_id, request) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A request'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B request');
insert into public.prayer_checks (owner_id, prayer_id, prayed_on) values
  ('11111111-1111-4111-8111-111111111111', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', current_date),
  ('22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff', current_date);

set local role anon;
select throws_ok('select id from public.care_people limit 1', '42501', null, 'anon cannot read people');
select throws_ok('select id from public.care_visits limit 1', '42501', null, 'anon cannot read visits');
select throws_ok('select id from public.prayer_items limit 1', '42501', null, 'anon cannot read prayers');
select throws_ok('select id from public.prayer_checks limit 1', '42501', null, 'anon cannot read prayer history');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select is_empty($$select id from public.care_people where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'A cannot read B person');
select is_empty($$select id from public.care_visits where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'$$, 'A cannot read B visit');
select is_empty($$select id from public.prayer_items where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'$$, 'A cannot read B prayer');
select is_empty($$select id from public.prayer_checks where prayer_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'$$, 'A cannot read B prayer history');
select results_eq($$select count(*) from public.prayer_checks where prayer_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$$,
  array[1::bigint], 'A reads own prayer history');
select throws_ok($$insert into public.prayer_checks (owner_id, prayer_id, prayed_on)
  values ('22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff', current_date - 1)$$,
  '42501', null, 'A cannot create B prayer history');
select throws_ok($$insert into public.prayer_checks (prayer_id, prayed_on)
  values ('ffffffff-ffff-4fff-8fff-ffffffffffff', current_date - 1)$$,
  '23503', null, 'A cannot link history to B prayer');
select throws_ok($$insert into public.prayer_checks (prayer_id, prayed_on)
  values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', current_date)$$,
  '23505', null, 'one prayer has at most one check per day');

select results_eq($$select id from public.care_people where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid], 'A reads own person');
select results_eq($$select id from public.care_visits where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$,
  array['cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid], 'A reads own visit');
select results_eq($$select id from public.prayer_items where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$$,
  array['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid], 'A reads own prayer');

select is_empty($$update public.care_people set name = 'changed' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning id$$,
  'A cannot update B person');
select is_empty($$update public.care_visits set place = 'changed' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' returning id$$,
  'A cannot update B visit');
select is_empty($$update public.prayer_items set request = 'changed' where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' returning id$$,
  'A cannot update B prayer');

select is_empty($$delete from public.care_people where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning id$$,
  'A cannot delete B person');
select is_empty($$delete from public.care_visits where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' returning id$$,
  'A cannot delete B visit');
select is_empty($$delete from public.prayer_items where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' returning id$$,
  'A cannot delete B prayer');

select throws_ok($$insert into public.care_people (owner_id, name)
  values ('22222222-2222-4222-8222-222222222222', 'forged')$$, '42501', null, 'A cannot create B person');
select throws_ok($$insert into public.care_visits (owner_id, person_id, visit_date)
  values ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current_date)$$,
  '42501', null, 'A cannot create B visit');
select throws_ok($$insert into public.prayer_items (owner_id, person_id, request)
  values ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'forged')$$,
  '42501', null, 'A cannot create B prayer');
select throws_ok($$insert into public.care_visits (person_id, visit_date)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current_date)$$,
  '23503', null, 'A cannot link a visit to B person');

select results_eq($$insert into public.care_visits
  (id, person_id, visit_date, prayer_note) values
  ('99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date, 'Pray again')
  returning id$$, array['99999999-9999-4999-8999-999999999999'::uuid], 'A creates a visit');
select results_eq($$select count(*) from public.prayer_items
  where source_visit_id = '99999999-9999-4999-8999-999999999999'$$,
  array[1::bigint], 'a visit creates one linked prayer');

update public.prayer_items set status = 'answered', answered_at = now()
  where source_visit_id = '99999999-9999-4999-8999-999999999999';
update public.care_visits set place = 'new place', prayer_note = 'Pray again'
  where id = '99999999-9999-4999-8999-999999999999';
select results_eq($$select count(*) from public.prayer_items
  where source_visit_id = '99999999-9999-4999-8999-999999999999' and status = 'answered'$$,
  array[1::bigint], 'editing unrelated visit fields does not reopen an answered prayer');

update public.care_visits set prayer_note = 'Pray anew'
  where id = '99999999-9999-4999-8999-999999999999';
select results_eq($$select count(*) from public.prayer_items
  where source_visit_id = '99999999-9999-4999-8999-999999999999' and status = 'active' and request = 'Pray anew'$$,
  array[1::bigint], 'changing prayer text creates a new linked request');

select * from finish();
rollback;
