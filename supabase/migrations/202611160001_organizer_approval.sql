create table public.organizer_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  is_reviewer boolean not null default false,
  check (not is_reviewer or decision = 'approved')
);
alter table public.organizer_access enable row level security;
revoke all on public.organizer_access from public, anon, authenticated;

-- Preserve access for existing confirmed organizers. New accounts have no approval row.
insert into public.organizer_access(user_id, decision)
select id, 'approved' from auth.users
where not is_anonymous and email_confirmed_at is not null;

create function public.cup_organizer_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'state', case when u.email_confirmed_at is null then 'pending' else coalesce(a.decision,'pending') end,
      'reviewer', u.email_confirmed_at is not null and coalesce(a.is_reviewer,false)
    )
    from auth.users u left join public.organizer_access a on a.user_id=u.id
    where u.id=auth.uid() and not u.is_anonymous
  ), '{"state":"pending","reviewer":false}'::jsonb)
$$;

create function public.cup_pending_organizers() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.cup_organizer_status()->>'reviewer')::boolean then
    raise exception 'Nur die Kontoverwaltung darf Anträge prüfen.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'createdAt',u.created_at) order by u.created_at)
    from auth.users u left join public.organizer_access a on a.user_id=u.id
    where not u.is_anonymous and u.email_confirmed_at is not null and a.user_id is null
  ),'[]'::jsonb);
end $$;

create function public.cup_review_organizer(applicant uuid, decision text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.cup_organizer_status()->>'reviewer')::boolean then
    raise exception 'Nur die Kontoverwaltung darf Anträge prüfen.';
  end if;
  if decision is null or decision not in ('approved','rejected') then
    raise exception 'Ungültige Entscheidung.';
  end if;
  insert into public.organizer_access(user_id,decision,reviewed_by)
  select u.id,decision,auth.uid() from auth.users u
  where u.id=applicant and not u.is_anonymous and u.email_confirmed_at is not null
  on conflict (user_id) do nothing;
  if not found then raise exception 'Dieser Antrag ist nicht mehr offen.'; end if;
end $$;

create or replace function public.cup_is_admin(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tournament_roles where tournament_id=t and user_id=auth.uid() and role='admin')
    and public.cup_organizer_status()->>'state' = 'approved'
$$;

create or replace function public.cup_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'date',t.day,'state',t.state) order by t.day desc,t.name),'[]')
  from public.tournaments t join public.tournament_roles r on r.tournament_id=t.id
  where r.user_id=auth.uid() and public.cup_organizer_status()->>'state' = 'approved'
$$;

alter function public.cup_save_plan(uuid,integer,jsonb,jsonb) rename to cup_save_plan_internal;
revoke all on function public.cup_save_plan_internal(uuid,integer,jsonb,jsonb) from public, anon, authenticated;

create function public.cup_save_plan(t uuid, expected integer, cfg jsonb, plan jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Melde dich mit einem Administratorkonto an.';
  end if;
  if public.cup_organizer_status()->>'state' <> 'approved' then
    raise exception 'Dieses Konto wurde noch nicht für die Turnierverwaltung freigegeben.';
  end if;
  return public.cup_save_plan_internal(t,expected,cfg,plan);
end $$;

revoke all on function public.cup_organizer_status(), public.cup_pending_organizers(),
  public.cup_review_organizer(uuid,text), public.cup_save_plan(uuid,integer,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.cup_organizer_status(), public.cup_pending_organizers(),
  public.cup_review_organizer(uuid,text), public.cup_save_plan(uuid,integer,jsonb,jsonb) to authenticated;
