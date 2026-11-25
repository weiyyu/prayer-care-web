-- Run once after 001 and 002. One nonblank visit prayer line becomes one linked item.
-- Existing items and their daily prayer checks remain intact.
begin;

do $$ begin
  if exists (select 1 from pg_attribute
    where attrelid = 'public.prayer_items'::regclass
      and attname = 'source_visit_line' and not attisdropped) then
    raise exception 'Migration 003 has already been applied';
  end if;
end $$;

alter table public.prayer_items add column if not exists source_visit_line integer;
update public.prayer_items set source_visit_line = 1
  where source_visit_id is not null and source_visit_line is null;
alter table public.prayer_items
  drop constraint if exists prayer_items_owner_id_source_visit_id_key;
create unique index if not exists prayer_items_visit_line_unique
  on public.prayer_items (owner_id, source_visit_id, source_visit_line)
  where source_visit_id is not null;

create or replace function public.sync_visit_prayer() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  linked public.prayer_items%rowtype;
  old_lines text[] := array[]::text[];
  next_lines text[] := array[]::text[];
  candidate_ids uuid[] := array[]::uuid[];
  candidate_texts text[] := array[]::text[];
  candidate_lines integer[] := array[]::integer[];
  line_index integer;
  candidate_index integer;
  match_index integer;
begin
  if tg_op = 'UPDATE' then
    if btrim(new.prayer_note) = old.synced_prayer and new.person_id = old.person_id then
      return null;
    end if;
    select coalesce(array_agg(btrim(line) order by ordinal)
      filter (where btrim(line) <> ''), array[]::text[])
      into old_lines
      from string_to_table(replace(replace(old.synced_prayer,
        chr(13) || chr(10), chr(10)), chr(13), chr(10)), chr(10))
        with ordinality as parts(line, ordinal);
  end if;

  select coalesce(array_agg(btrim(line) order by ordinal)
    filter (where btrim(line) <> ''), array[]::text[])
    into next_lines
    from string_to_table(replace(replace(new.prayer_note,
      chr(13) || chr(10), chr(10)), chr(13), chr(10)), chr(10))
      with ordinality as parts(line, ordinal);

  for linked in select * from public.prayer_items
      where owner_id = new.owner_id and source_visit_id = new.id
      order by source_visit_line, created_at, id for update loop
    if tg_op = 'UPDATE' and linked.status <> 'answered' and
       (linked.request = old_lines[linked.source_visit_line] or
        (linked.source_visit_line = 1 and linked.request = btrim(old.prayer_note))) then
      candidate_ids := array_append(candidate_ids, linked.id);
      candidate_texts := array_append(candidate_texts, linked.request);
      candidate_lines := array_append(candidate_lines, linked.source_visit_line);
    end if;
    update public.prayer_items
      set source_visit_id = null, source_visit_line = null, updated_at = now()
      where id = linked.id and owner_id = new.owner_id;
  end loop;

  for line_index in 1..coalesce(array_length(next_lines, 1), 0) loop
    match_index := null;
    for candidate_index in 1..coalesce(array_length(candidate_ids, 1), 0) loop
      if candidate_ids[candidate_index] is not null and
         candidate_texts[candidate_index] = next_lines[line_index] then
        match_index := candidate_index;
        exit;
      end if;
    end loop;
    if match_index is null then
      for candidate_index in 1..coalesce(array_length(candidate_ids, 1), 0) loop
        if candidate_ids[candidate_index] is not null and
           candidate_lines[candidate_index] = line_index then
          match_index := candidate_index;
          exit;
        end if;
      end loop;
    end if;

    if match_index is null then
      insert into public.prayer_items
        (owner_id, person_id, request, source_visit_id, source_visit_line)
        values (new.owner_id, new.person_id, next_lines[line_index], new.id, line_index);
    else
      update public.prayer_items
        set person_id = new.person_id, request = next_lines[line_index],
            source_visit_id = new.id, source_visit_line = line_index, updated_at = now()
        where id = candidate_ids[match_index] and owner_id = new.owner_id;
      candidate_ids[match_index] := null;
    end if;
  end loop;

  update public.care_visits set synced_prayer = btrim(new.prayer_note)
    where id = new.id and owner_id = new.owner_id;
  return null;
end;
$$;

drop trigger if exists care_visit_prayer_sync on public.care_visits;
create trigger care_visit_prayer_sync
  after insert or update of prayer_note, person_id on public.care_visits
  for each row execute function public.sync_visit_prayer();

-- Re-run only older multiline visits. Reuse their original linked item for line 1
-- so any daily prayer history remains attached to the same item ID.
update public.care_visits set synced_prayer = ''
  where position(chr(10) in prayer_note) > 0 or position(chr(13) in prayer_note) > 0;
update public.care_visits set prayer_note = prayer_note
  where position(chr(10) in prayer_note) > 0 or position(chr(13) in prayer_note) > 0;

commit;
