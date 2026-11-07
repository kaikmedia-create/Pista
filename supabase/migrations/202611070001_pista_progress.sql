-- DRAFT. Apply only to a newly authorized, verified Free-tier Pista project.
-- No athlete accounts, credentials or memberships are created by this migration.
-- A privileged provisioning step must add the sole authorized Auth user to
-- pista_members and configure authentication before the frontend is enabled.
begin;

create table public.pista_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.pista_members enable row level security;
revoke all on public.pista_members from public, anon, authenticated;
grant select on public.pista_members to authenticated;
create policy pista_member_self on public.pista_members for select to authenticated
  using (user_id = (select auth.uid()));

create table public.pista_progress (
  owner_id uuid not null references public.pista_members(user_id) on delete cascade,
  plan_id text not null check (plan_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$'),
  workout_id text not null check (workout_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$'),
  field text not null check (field in ('done', 'note')),
  value jsonb not null,
  stamp bigint not null check (stamp between 1 and 9000000000000000),
  actor uuid not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, plan_id, workout_id, field),
  check ((field = 'done' and jsonb_typeof(value) = 'boolean') or
    (field = 'note' and jsonb_typeof(value) = 'string' and length(value #>> '{}') <= 2000))
);
alter table public.pista_progress enable row level security;
revoke all on public.pista_progress from public, anon, authenticated;
grant select on public.pista_progress to authenticated;
create policy pista_progress_self on public.pista_progress for select to authenticated
  using (owner_id = (select auth.uid()) and exists (
    select 1 from public.pista_members m where m.user_id = (select auth.uid())
  ));

-- All mutations pass through this function; direct authenticated table writes
-- stay denied. SECURITY DEFINER has a pinned empty search_path, explicit schema
-- names, an auth.uid check and an independently provisioned membership check.
create function public.pista_exchange(p_plan text, p_changes jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  result jsonb;
begin
  if uid is null or not exists (select 1 from public.pista_members where user_id = uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_plan is null or p_plan !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$' then
    raise exception 'Invalid plan' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Invalid changes' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 100 or octet_length(p_changes::text) > 1000000 then
    raise exception 'Changes too large' using errcode = '22023';
  end if;
  -- Deterministic row-lock order prevents inverted multi-row update deadlocks.
  for item in
    select x from jsonb_array_elements(p_changes) as t(x)
    order by x->>'workout_id', x->>'field', (x->>'stamp')::bigint, x->>'actor'
  loop
    if jsonb_typeof(item) <> 'object' or
      not (item ?& array['workout_id','field','value','stamp','actor']) or
      jsonb_typeof(item->'stamp') <> 'number' or
      (item->>'stamp') !~ '^[1-9][0-9]{0,15}$' or
      (item->>'actor') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception 'Invalid change' using errcode = '22023';
    end if;
    insert into public.pista_progress as current
      (owner_id, plan_id, workout_id, field, value, stamp, actor)
    values
      (uid, p_plan, item->>'workout_id', item->>'field', item->'value',
       (item->>'stamp')::bigint, (item->>'actor')::uuid)
    on conflict (owner_id, plan_id, workout_id, field) do update
      set value = excluded.value, stamp = excluded.stamp, actor = excluded.actor,
          updated_at = now()
      where (excluded.stamp, excluded.actor) > (current.stamp, current.actor);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object(
    'workout_id', workout_id, 'field', field, 'value', value, 'stamp', stamp, 'actor', actor
  ) order by workout_id, field), '[]'::jsonb)
  into result from public.pista_progress where owner_id = uid and plan_id = p_plan;
  return result;
end;
$$;
revoke all on function public.pista_exchange(text, jsonb) from public, anon;
grant execute on function public.pista_exchange(text, jsonb) to authenticated;

-- Realtime still obeys SELECT/RLS; no anonymous progress feed.
alter publication supabase_realtime add table public.pista_progress;
commit;
