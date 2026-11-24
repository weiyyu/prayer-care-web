-- Run once in a new Supabase project. All application tables are user-owned.
create extension if not exists pgcrypto;

create table public.care_people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  category text not null default '',
  is_profiled boolean not null default true,
  birthday date,
  residence text not null default '',
  feeling text not null default '',
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index care_people_owner_name on public.care_people (owner_id, lower(btrim(name)));
create index care_people_owner_category on public.care_people (owner_id, category);

create table public.care_visits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person_id uuid not null,
  visit_date date not null,
  place text not null default '',
  family_note text not null default '',
  work_note text not null default '',
  spiritual_note text not null default '',
  prayer_note text not null default '',
  synced_prayer text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint care_visits_person_owner foreign key (person_id, owner_id)
    references public.care_people(id, owner_id) on delete cascade
);
create index care_visits_person_date on public.care_visits (owner_id, person_id, visit_date desc);

create table public.prayer_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person_id uuid not null,
  request text not null check (length(btrim(request)) > 0),
  status text not null default 'active' check (status in ('active', 'prayed', 'answered')),
  is_pinned boolean not null default false,
  answered_at timestamptz,
  answered_note text not null default '',
  source_visit_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prayer_items_person_owner foreign key (person_id, owner_id)
    references public.care_people(id, owner_id) on delete cascade,
  constraint prayer_items_visit_owner foreign key (source_visit_id, owner_id)
    references public.care_visits(id, owner_id) on delete set null (source_visit_id),
  constraint prayer_items_answer_consistency check (
    (status = 'answered' and answered_at is not null) or
    (status <> 'answered' and answered_at is null)
  ),
  unique (owner_id, source_visit_id)
);
create index prayer_items_owner_status on public.prayer_items (owner_id, status, is_pinned desc, created_at desc);
create index prayer_items_person on public.prayer_items (owner_id, person_id);

alter table public.care_people enable row level security;
alter table public.care_visits enable row level security;
alter table public.prayer_items enable row level security;

revoke all on public.care_people, public.care_visits, public.prayer_items from anon, authenticated;
grant select, insert, update, delete on public.care_people, public.care_visits, public.prayer_items to authenticated;

create policy "owner only" on public.care_people for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "owner only" on public.care_visits for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "owner only" on public.prayer_items for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- A visit's prayer note is mirrored as one prayer item. Preserve manually edited
-- or answered items by detaching the old link instead of overwriting them.
create function public.sync_visit_prayer() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  linked public.prayer_items%rowtype;
  old_synced text := '';
begin
  if tg_op = 'UPDATE' then
    old_synced := old.synced_prayer;
    if btrim(new.prayer_note) = old_synced and new.person_id = old.person_id then
      return null;
    end if;
  end if;

  select * into linked from public.prayer_items
    where owner_id = new.owner_id and source_visit_id = new.id for update;

  if linked.id is not null then
    if btrim(new.prayer_note) = '' or linked.status = 'answered' or linked.request <> old_synced then
      update public.prayer_items set source_visit_id = null, updated_at = now()
        where id = linked.id and owner_id = new.owner_id;
    else
      update public.prayer_items set request = btrim(new.prayer_note), person_id = new.person_id, updated_at = now()
        where id = linked.id and owner_id = new.owner_id;
    end if;
  end if;

  if btrim(new.prayer_note) <> '' and
    (linked.id is null or linked.status = 'answered' or linked.request <> old_synced) then
    insert into public.prayer_items (owner_id, person_id, request, source_visit_id)
      values (new.owner_id, new.person_id, btrim(new.prayer_note), new.id);
  end if;

  update public.care_visits set synced_prayer = btrim(new.prayer_note)
    where id = new.id and owner_id = new.owner_id;
  return null;
end;
$$;
create trigger care_visit_prayer_sync after insert or update of prayer_note
  on public.care_visits for each row execute function public.sync_visit_prayer();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('person-photos', 'person-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "owner reads photos" on storage.objects for select to authenticated
  using (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner uploads photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner updates photos" on storage.objects for update to authenticated
  using (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner deletes photos" on storage.objects for delete to authenticated
  using (bucket_id = 'person-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
