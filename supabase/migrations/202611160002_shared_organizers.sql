-- Approved organizers share tournament administration. Account review remains a separate permission.
create unique index organizer_access_single_reviewer on public.organizer_access (is_reviewer) where is_reviewer;

create or replace function public.cup_is_admin(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.cup_organizer_status()->>'state' = 'approved'
    and exists(select 1 from public.tournaments where id=t)
$$;

create or replace function public.cup_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'date',t.day,'state',t.state) order by t.day desc,t.name),'[]')
  from public.tournaments t where public.cup_organizer_status()->>'state' = 'approved'
$$;

create function public.cup_active_organizers() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.cup_organizer_status()->>'reviewer')::boolean then
    raise exception 'Nur die Kontoverwaltung darf freigegebene Konten sehen.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'createdAt',u.created_at) order by u.email)
    from public.organizer_access a join auth.users u on u.id=a.user_id
    where a.decision='approved' and not a.is_reviewer
  ),'[]'::jsonb);
end $$;

create function public.cup_revoke_organizer(applicant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.cup_organizer_status()->>'reviewer')::boolean then
    raise exception 'Nur die Kontoverwaltung darf Zugänge entziehen.';
  end if;
  update public.organizer_access set decision='rejected', reviewed_by=auth.uid(), reviewed_at=clock_timestamp()
  where user_id=applicant and decision='approved' and not is_reviewer;
  if not found then raise exception 'Dieser Zugang kann nicht entzogen werden.'; end if;
end $$;

revoke all on function public.cup_active_organizers(), public.cup_revoke_organizer(uuid) from public, anon, authenticated;
grant execute on function public.cup_active_organizers(), public.cup_revoke_organizer(uuid) to authenticated;

alter table public.tournaments add column locked_seeds jsonb not null default '{}';

create or replace function public.cup_qualified(t uuid,cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare seeds jsonb := '{}'; grp record; ranked_team text; place integer; games jsonb; rows jsonb; criterion text;
  rules jsonb := cfg->'rules'; primary_rule text; criteria text[];
  win int := (rules->>'win')::int; loss int := (rules->>'loss')::int; draw int := (rules->>'draw')::int;
begin
  select locked_seeds into seeds from public.tournaments where id=t;
  for grp in select g.id from public.groups g join public.stages s on (g.tournament_id,g.stage_id)=(s.tournament_id,s.id)
    where g.tournament_id=t order by s.ordinal,g.id
  loop
    if not exists(select 1 from public.matches where tournament_id=t and group_id=grp.id)
      or exists(select 1 from public.stage_entries e where e.tournament_id=t and e.group_id=grp.id and e.team_id is null and not (seeds ? e.seed))
      or exists(select 1 from public.matches m where m.tournament_id=t and m.group_id=grp.id and m.status not in ('confirmed','corrected'))
    then continue; end if;

    with resolved as (
      select p.id,p.group_id,coalesce(seeds->>p.a,p.a) a,coalesce(seeds->>p.b,p.b) b,r.score_a sa,r.score_b sb
      from public.cup_pairs p join public.results r on (r.tournament_id,r.match_id)=(p.tournament_id,p.id)
      where p.tournament_id=t
    )
    select coalesce(jsonb_agg(jsonb_build_object('a',a,'b',b,'sa',sa,'sb',sb)),'[]') into games
    from resolved x where x.group_id=grp.id or exists (
      select 1 from public.carry_over c where c.tournament_id=t and c.group_id=grp.id and c.source_group=x.group_id
      and least(seeds->>c.a,seeds->>c.b)=least(x.a,x.b) and greatest(seeds->>c.a,seeds->>c.b)=greatest(x.a,x.b)
    );
    if jsonb_array_length(games) <> (select count(*) from public.matches where tournament_id=t and group_id=grp.id) +
      (select count(*) from public.carry_over where tournament_id=t and group_id=grp.id) then continue; end if;

    with entries as (
      select coalesce(e.team_id,seeds->>e.seed) team from public.stage_entries e where e.tournament_id=t and e.group_id=grp.id
    ), oriented as (
      select a team,sa scored,sb conceded from jsonb_to_recordset(games) as g(a text,b text,sa int,sb int)
      union all select b,sb,sa from jsonb_to_recordset(games) as g(a text,b text,sa int,sb int)
    ), totals as (
      select e.team,count(o.team) n,coalesce(sum(o.scored),0) scored,coalesce(sum(o.conceded),0) conceded,
        coalesce(sum(case when o.scored>o.conceded then win when o.scored<o.conceded then loss when o.team is not null then draw else 0 end),0) points
      from entries e left join oriented o using(team) group by e.team
    )
    select jsonb_agg(jsonb_build_object('team',team,'n',n,'scored',scored,'conceded',conceded,'points',points,'bucket',0)) into rows from totals;

    primary_rule := rules->>'primary';
    if primary_rule='auto' then
      select case when count(distinct n)>1 then 'average' else 'points' end into primary_rule from jsonb_to_recordset(rows) r(n integer);
    elsif primary_rule='total' then primary_rule := 'points'; end if;
    criteria := array[primary_rule] || array(select jsonb_array_elements_text(rules->'tie'));
    foreach criterion in array criteria loop
      with entries as (select * from jsonb_to_recordset(rows) r(team text,n int,scored int,conceded int,points int,bucket int)),
      mini as (
        select e.team, coalesce(sum(case when g.a=e.team and g.sa>g.sb or g.b=e.team and g.sb>g.sa then win
          when g.sa=g.sb then draw else loss end) filter (where g.a is not null),0) points
        from entries e left join jsonb_to_recordset(games) g(a text,b text,sa int,sb int)
          on (g.a=e.team or g.b=e.team) and exists(select 1 from entries o where o.team=case when g.a=e.team then g.b else g.a end and o.bucket=e.bucket)
        group by e.team
      ), ordered as (
        select e.team,e.n,e.scored,e.conceded,e.points,dense_rank() over(order by e.bucket,
          case criterion
            when 'points' then e.points
            when 'average' then coalesce(e.points::numeric/nullif(e.n,0),0)
            when 'scored' then e.scored
            when 'difference' then e.scored-e.conceded
            when 'headToHead' then mini.points
            when 'draw' then public.cup_hash(grp.id||'/'||e.team)
            when 'quotient' then case when e.conceded>0 then e.scored::numeric/e.conceded when e.scored>0 then 'Infinity'::numeric else 0 end
          end desc) bucket
        from entries e join mini using(team)
      )
      select jsonb_agg(to_jsonb(o)) into rows from ordered o;
    end loop;
    place := 0;
    for ranked_team in select r.team from jsonb_to_recordset(rows) r(team text,bucket int) order by bucket,r.team collate "C" loop
      place := place+1;
      seeds := seeds || jsonb_build_object('@'||grp.id||'/'||place,coalesce(seeds->>('@'||grp.id||'/'||place),ranked_team));
    end loop;
  end loop;
  return seeds;
end $$;

create or replace function public.cup_game(t uuid, game integer, expected integer, request uuid, action text, sa integer default null, sb integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare tour public.tournaments; m public.matches; old public.matches; cfg jsonb; pair record; receipt public.audit_logs;
  admin boolean; allowed_draw boolean; ts timestamptz; auto_confirm boolean; seeds jsonb; stage_index integer; official boolean := false;
  previous_seeds jsonb; protected_seeds jsonb; cutoff integer;
  correction boolean := action in ('correct','correct_keep_fixtures');
  home text; away text; ref_team text;
begin
  select * into tour from public.tournaments where id=t for update;
  if not found or (tour.state<>'published' and not (tour.state='archived' and correction)) then raise exception 'Das Turnier ist für Eingaben geschlossen.'; end if;
  admin := public.cup_is_admin(t);
  if not admin and (action not in ('live','submit') or not public.cup_can_report(t,game)) then raise exception 'Kein gültiger Schreibzugang für dieses Spiel.'; end if;
  if request is null or expected is null then raise exception 'Anfragekennung und Spielversion sind erforderlich.'; end if;
  select * into m from public.matches where tournament_id=t and id=game for update;
  if not found then raise exception 'Spiel nicht gefunden.'; end if;
  select * into receipt from public.audit_logs where tournament_id=t and request_id=request;
  if found then
    if receipt.actor=auth.uid() and receipt.match_id=game and receipt.action=action and
        receipt.payload->'input'=jsonb_build_array(sa,sb) and receipt.payload->>'previousVersion'=expected::text then return m.version; end if;
    raise exception 'Die Anfragekennung wurde bereits verwendet.';
  end if;
  if m.version<>expected then raise exception 'Versionskonflikt. Prüfe den aktuellen Spielstand.'; end if;
  select ordinal into stage_index from public.stages where tournament_id=t and id=m.stage_id;
  if stage_index>tour.released then raise exception 'Diese Phase wurde noch nicht freigegeben.'; end if;
  select configuration into cfg from public.tournament_configurations where tournament_id=t and version=tour.configuration_version;
  allowed_draw := coalesce((cfg->'rules'->>'allowDraw')::boolean,false);
  auto_confirm := coalesce((cfg->'rules'->>'autoConfirm')::boolean,false);
  if (action in ('live','submit') or correction) and (sa is null or sb is null or sa not between 0 and 999 or sb not between 0 and 999)
    then raise exception 'Gib je Team eine ganze Punktzahl zwischen 0 und 999 ein.'; end if;
  if (action='submit' or correction) and not allowed_draw and sa=sb then raise exception 'Bei Gleichstand entscheidet der nächste Punkt.'; end if;
  ts := clock_timestamp();
  old := m;
  if action='start' and m.status='scheduled' then
    select * into pair from public.cup_pairs where tournament_id=t and id=game;
    seeds := public.cup_qualified(t,cfg);
    home := coalesce(seeds->>pair.a,pair.a);
    away := coalesce(seeds->>pair.b,pair.b);
    ref_team := coalesce(seeds->>pair.referee,pair.referee);
    if home like '@%' or away like '@%' or ref_team like '@%' or home=away or ref_team in (home,away) then
      raise exception 'Die Teilnehmerzuordnung ist noch nicht vollständig oder enthält einen Konflikt.';
    end if;
    if exists (select 1 from public.matches other join public.cup_pairs p on (p.tournament_id,p.id)=(other.tournament_id,other.id)
      where other.tournament_id=t and other.status='running' and (
        other.court_id=m.court_id or exists(select 1 from unnest(array[p.a,p.b,p.referee]) e(seed)
          where coalesce(seeds->>e.seed,e.seed) in (home,away,ref_team))
      )) then raise exception 'Feld oder Team ist in einem laufenden Spiel belegt.'; end if;
    m.status := 'running'; m.started := ts; m.live_a := 0; m.live_b := 0;
  elsif action='pause' and m.status='running' and m.paused is null and m.regular_ended is null then
    m.paused := ts;
  elsif action='resume' and m.status='running' and m.paused is not null and m.regular_ended is null then
    m.paused_ms := m.paused_ms + greatest(0,round(extract(epoch from (ts-m.paused))*1000)::bigint); m.paused := null;
  elsif action='regular' and m.status='running' and m.regular_ended is null then
    m.regular_ended := ts; m.paused := null; m.extra := not allowed_draw and m.live_a=m.live_b;
  elsif action in ('live','submit') and m.status='running' then
    if m.extra and (sa<>m.live_a or sb<>m.live_b) and (
      m.live_a<>m.live_b or not ((sa=m.live_a+1 and sb=m.live_b) or (sa=m.live_a and sb=m.live_b+1))
    ) then raise exception 'Beim Zusatzpunkt darf genau ein Team einen Punkt erzielen.'; end if;
    m.live_a := sa; m.live_b := sb;
    if action='submit' then
      m.status := case when auto_confirm then 'confirmed' else 'submitted' end;
      m.ended := ts; m.paused := null;
      insert into public.result_submissions values(t,game,m.version+1,auth.uid(),sa,sb,ts);
      official := auto_confirm;
    end if;
  elsif action='confirm' and m.status='submitted' then
    m.status := 'confirmed'; official := true;
  elsif action='reject' and m.status='submitted' then
    if exists(select 1 from public.matches where tournament_id=t and status='running') then
      raise exception 'Beende die laufenden Spiele, bevor ein Ergebnis zur Neueingabe geöffnet wird.';
    end if;
    m.status := 'running'; m.ended := null;
  elsif correction and m.status in ('submitted','confirmed','corrected') then
    select max(st.ordinal) into cutoff
    from public.matches later join public.stages st on (st.tournament_id,st.id)=(later.tournament_id,later.stage_id)
    where later.tournament_id=t and st.ordinal>stage_index and later.started is not null;
    if cutoff is not null then previous_seeds := public.cup_qualified(t,cfg); end if;
    m.status := 'corrected'; m.live_a := sa; m.live_b := sb; official := true;
  else raise exception 'Diese Aktion ist im aktuellen Spielstatus nicht verfügbar.'; end if;
  update public.matches set status=m.status, version=m.version+1, started=m.started, paused=m.paused, paused_ms=m.paused_ms,
    regular_ended=m.regular_ended, ended=m.ended, extra=m.extra, live_a=m.live_a, live_b=m.live_b where tournament_id=t and id=game;
  if official then
    insert into public.results values(t,game,m.live_a,m.live_b,ts)
    on conflict (tournament_id,match_id) do update set score_a=excluded.score_a,score_b=excluded.score_b,updated_at=excluded.updated_at;
  end if;
  if cutoff is not null then
    seeds := public.cup_qualified(t,cfg);
    select jsonb_object_agg(entry.key,entry.value) into protected_seeds
    from jsonb_each(previous_seeds) entry
    where exists (
      select 1 from public.groups g join public.stages st on (st.tournament_id,st.id)=(g.tournament_id,g.stage_id)
      where g.tournament_id=t and st.ordinal<cutoff and split_part(entry.key,'/',1)='@'||g.id
    );
    if exists (select 1 from jsonb_each(protected_seeds) e where seeds->e.key is distinct from e.value) then
      if action<>'correct_keep_fixtures' then
        raise exception 'Die Korrektur ändert die Qualifikation einer begonnenen Folgephase. Bestätige die Korrektur mit unveränderten Paarungen.';
      end if;
      update public.tournaments set locked_seeds=locked_seeds||protected_seeds where id=t;
    end if;
  end if;
  insert into public.audit_logs(tournament_id,request_id,actor,action,match_id,payload)
    values(t,request,auth.uid(),action,game,jsonb_build_object('from',old.status,'to',m.status,
    'before',jsonb_build_array(old.live_a,old.live_b),'after',jsonb_build_array(m.live_a,m.live_b),
    'input',jsonb_build_array(sa,sb),'previousVersion',expected));
  perform public.cup_touch(t);
  return m.version+1;
end $$;

create or replace function public.cup_list_court_stations(t uuid) returns jsonb
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
    where s.tournament_id is not null or s.owner_id=auth.uid()
  ), '[]'::jsonb);
end $$;

create or replace function public.cup_activate_court(t uuid, field text, station uuid default null, expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved public.court_stations; label text; pin text; expiry timestamptz; identifier uuid;
begin
  if not public.cup_is_admin(t) then raise exception 'Keine Verwaltungsberechtigung.'; end if;
  if station is not null then
    select * into saved from public.court_stations where id=station and (tournament_id is not null or owner_id=auth.uid()) for update;
    if not found then raise exception 'Dieser Feld-QR ist für dein Konto nicht verfügbar.'; end if;
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
