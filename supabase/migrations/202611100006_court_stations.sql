create table public.court_stations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null,
  tournament_id uuid,
  court_id text,
  pin_hash text not null,
  expires timestamptz not null,
  failures integer not null default 0,
  blocked_until timestamptz,
  foreign key (tournament_id, court_id) references public.courts on delete set null,
  unique (tournament_id, court_id)
);
create table public.court_referee_access (
  station_id uuid not null references public.court_stations on delete cascade,
  tournament_id uuid not null,
  match_id integer not null,
  user_id uuid not null references auth.users on delete cascade,
  foreign key (tournament_id, match_id) references public.matches on delete cascade,
  primary key (station_id, tournament_id, match_id, user_id)
);
alter table public.court_stations enable row level security;
alter table public.court_referee_access enable row level security;
revoke all on public.court_stations, public.court_referee_access from public, anon, authenticated;

create function public.cup_list_court_stations(t uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.cup_is_admin(t) then raise exception 'Keine Verwaltungsberechtigung.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name,
      'assignment', case when s.tournament_id is not null then jsonb_build_object('tournamentId', s.tournament_id, 'field', s.court_id) end,
      'tournamentName', other.name, 'expires', s.expires
    ) order by s.name, s.id)
    from public.court_stations s left join public.tournaments other on other.id=s.tournament_id
    where s.owner_id=auth.uid()
  ), '[]'::jsonb);
end $$;

create function public.cup_activate_court(t uuid, field text, station uuid default null, expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved public.court_stations; label text; pin text; expiry timestamptz; identifier uuid;
begin
  if not public.cup_is_admin(t) then raise exception 'Keine Verwaltungsberechtigung.'; end if;
  if station is not null then
    select * into saved from public.court_stations where id=station and owner_id=auth.uid() for update;
    if not found then raise exception 'Dieser Feld-QR gehört nicht zu deinem Konto.'; end if;
    if saved.expires is distinct from expected then raise exception 'Dieser Feld-QR wurde inzwischen geändert. Prüfe die aktuelle Zuordnung.'; end if;
  end if;
  -- Serialize changes to both assignments with submissions and tournament status changes.
  perform 1 from public.tournaments where id in (t, saved.tournament_id) order by id for update;
  select c.name into label from public.courts c join public.tournaments tour on tour.id=c.tournament_id
    where tour.id=t and tour.state='published' and c.id=field;
  if not found then raise exception 'Veröffentliche das Turnier, bevor du einen Feld-QR zuordnest.'; end if;
  if exists(select 1 from public.court_stations s where s.tournament_id=t and s.court_id=field and s.id is distinct from station)
    then raise exception 'Diesem Feld ist bereits ein Feld-QR zugeordnet.'; end if;

  pin := lpad(((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint % 100000000)::text),8,'0');
  if saved.id is not null and extensions.crypt(pin,saved.pin_hash)=saved.pin_hash then
    pin := lpad(((pin::integer+1)%100000000)::text,8,'0');
  end if;
  expiry := clock_timestamp()+interval '12 hours';
  if station is null then
    insert into public.court_stations(owner_id,name,tournament_id,court_id,pin_hash,expires)
      values(auth.uid(),label,t,field,extensions.crypt(pin,extensions.gen_salt('bf',8)),expiry) returning id into identifier;
  else
    identifier := station;
    update public.court_stations set tournament_id=t, court_id=field,
      pin_hash=extensions.crypt(pin,extensions.gen_salt('bf',8)), expires=expiry, failures=0, blocked_until=null
      where id=identifier;
    delete from public.court_referee_access where station_id=identifier;
  end if;
  insert into public.audit_logs(tournament_id,actor,action,payload)
    values(t,auth.uid(),'court_activate',jsonb_build_object('field',field,'station',identifier,'previousTournament',saved.tournament_id));
  return jsonb_build_object('id',identifier,'pin',pin,'expires',expiry);
end $$;

create function public.cup_resolve_court(station uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('tournamentId',s.tournament_id,'field',s.court_id,'expires',s.expires)
  from public.court_stations s join public.tournaments t on t.id=s.tournament_id and t.state='published'
  where s.id=station
$$;

create function public.cup_redeem_court(station uuid, t uuid, game integer, pin text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare saved public.court_stations; stamp timestamptz;
begin
  if auth.uid() is null or coalesce(pin,'') !~ '^[0-9]{8}$' then return false; end if;
  select * into saved from public.court_stations where id=station and tournament_id=t for update;
  if not found then return false; end if;
  perform 1 from public.tournaments where id=t and state='published' for update;
  if not found then return false; end if;
  if not exists(select 1 from public.matches m where m.tournament_id=t and m.id=game and m.court_id=saved.court_id and m.status='running')
    then return false; end if;
  stamp := clock_timestamp();
  if saved.expires<=stamp or saved.blocked_until>stamp then return false; end if;
  if extensions.crypt(pin,saved.pin_hash)<>saved.pin_hash then
    update public.court_stations
      set failures=case when saved.failures=7 then 0 else saved.failures+1 end,
        blocked_until=case when saved.failures=7 then stamp+interval '5 minutes' end
      where id=station;
    return false;
  end if;
  update public.court_stations set failures=0, blocked_until=null where id=station;
  insert into public.court_referee_access(station_id,tournament_id,match_id,user_id)
    values(station,t,game,auth.uid()) on conflict do nothing;
  if found then
    insert into public.audit_logs(tournament_id,actor,action,match_id,payload)
      values(t,auth.uid(),'court_redeem',game,jsonb_build_object('station',station,'field',saved.court_id));
  end if;
  return true;
end $$;

create or replace function public.cup_can_report(t uuid, game integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.cup_is_admin(t)
    or exists(select 1 from public.referee_access where tournament_id=t and match_id=game and user_id=auth.uid() and expires>statement_timestamp())
    or exists(
      select 1 from public.court_referee_access a
      join public.court_stations s on s.id=a.station_id and s.tournament_id=a.tournament_id
      join public.matches m on m.tournament_id=a.tournament_id and m.id=a.match_id and m.court_id=s.court_id
      join public.tournaments tour on tour.id=a.tournament_id and tour.state='published'
      where a.tournament_id=t and a.match_id=game and a.user_id=auth.uid() and s.expires>statement_timestamp()
    )
$$;

revoke all on function public.cup_list_court_stations(uuid), public.cup_activate_court(uuid,text,uuid,timestamptz),
  public.cup_resolve_court(uuid), public.cup_redeem_court(uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.cup_resolve_court(uuid) to anon, authenticated;
grant execute on function public.cup_list_court_stations(uuid), public.cup_activate_court(uuid,text,uuid,timestamptz),
  public.cup_redeem_court(uuid,uuid,integer,text) to authenticated;
