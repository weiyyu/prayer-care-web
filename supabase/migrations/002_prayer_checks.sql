-- Additive migration for daily prayer history. Keep legacy prayer_items.status rows intact.
begin;
create unique index if not exists prayer_items_id_owner_unique on public.prayer_items (id, owner_id);
create table if not exists public.prayer_checks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  prayer_id uuid not null,
  prayed_on date not null,
  created_at timestamptz not null default now(),
  constraint prayer_checks_prayer_owner foreign key (prayer_id, owner_id)
    references public.prayer_items(id, owner_id) on delete cascade,
  unique (owner_id, prayer_id, prayed_on)
);
create index if not exists prayer_checks_owner_date on public.prayer_checks (owner_id, prayed_on desc);

alter table public.prayer_checks enable row level security;
revoke all on public.prayer_checks from anon, authenticated;
grant select, insert, delete on public.prayer_checks to authenticated;
create policy "owner only" on public.prayer_checks for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Preserve an old "prayed" marker as a dated record without changing the item.
insert into public.prayer_checks (owner_id, prayer_id, prayed_on)
select owner_id, id, (updated_at at time zone 'Asia/Taipei')::date
from public.prayer_items where status = 'prayed'
on conflict (owner_id, prayer_id, prayed_on) do nothing;
commit;
