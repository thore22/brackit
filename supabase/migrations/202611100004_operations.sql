create function public.cup_control(t uuid, expected integer, action text) returns void
language plpgsql security definer set search_path = '' as $$
declare tour public.tournaments;
begin
  if not public.cup_is_admin(t) then raise exception 'Keine Verwaltungsberechtigung.'; end if;
  select * into tour from public.tournaments where id=t for update;
  if tour.revision is distinct from expected then raise exception 'Versionskonflikt. Lade den aktuellen Stand.'; end if;
  if action='publish' and tour.state='draft' then
    update public.tournaments set state='published' where id=t;
  elsif action='release' and tour.state='published' then
    if not exists(select 1 from public.stages where tournament_id=t and ordinal=tour.released+1) then raise exception 'Es gibt keine weitere Phase.'; end if;
    if exists(select 1 from public.matches m join public.stages s on (s.tournament_id,s.id)=(m.tournament_id,m.stage_id)
      where m.tournament_id=t and s.ordinal<=tour.released and m.status not in ('confirmed','corrected')) then
      raise exception 'Bestätige zuerst alle Ergebnisse der freigegebenen Phasen.';
    end if;
    update public.tournaments set released=released+1 where id=t;
  elsif action='archive' and tour.state='published' then
    if exists(select 1 from public.matches where tournament_id=t and status not in ('confirmed','corrected')) then
      raise exception 'Archivierung ist nach Bestätigung aller Spiele möglich.';
    end if;
    update public.tournaments set state='archived' where id=t;
    delete from public.referee_access where tournament_id=t;
    delete from public.referee_invites where tournament_id=t;
  else raise exception 'Diese Aktion ist im aktuellen Turnierstatus nicht verfügbar.'; end if;
  perform public.cup_touch(t);
  insert into public.audit_logs(tournament_id,actor,action) values(t,auth.uid(),action);
end $$;

create function public.cup_issue_ref(t uuid, game integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tour public.tournaments; token text; pin text; expiry timestamptz;
begin
  if not public.cup_is_admin(t) then raise exception 'Keine Verwaltungsberechtigung.'; end if;
  select * into tour from public.tournaments where id=t for update;
  if tour.state<>'published' or not exists(select 1 from public.matches where tournament_id=t and id=game and status in ('scheduled','running')) then
    raise exception 'Wähle ein geplantes oder laufendes Spiel eines veröffentlichten Turniers.';
  end if;
  token := encode(extensions.gen_random_bytes(24),'hex');
  pin := lpad(((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint % 100000000)::text),8,'0');
  expiry := clock_timestamp()+interval '12 hours';
  delete from public.referee_invites where tournament_id=t and match_id=game;
  delete from public.referee_access where tournament_id=t and match_id=game;
  insert into public.referee_invites values (extensions.digest(token,'sha256'),t,game,extensions.crypt(pin,extensions.gen_salt('bf',8)),expiry,0);
  insert into public.audit_logs(tournament_id,actor,action,match_id) values(t,auth.uid(),'referee_invite',game);
  return jsonb_build_object('token',token,'pin',pin,'expires',expiry);
end $$;

create function public.cup_redeem_ref(t uuid, game integer, token text, pin text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare invite public.referee_invites; hashed bytea;
begin
  if auth.uid() is null or coalesce(token,'') !~ '^[0-9a-f]{48}$' or coalesce(pin,'') !~ '^[0-9]{8}$' then return false; end if;
  perform 1 from public.tournaments where id=t and state='published' for update;
  if not found then return false; end if;
  hashed := extensions.digest(token,'sha256');
  select * into invite from public.referee_invites where token_hash=hashed and tournament_id=t and match_id=game for update;
  if not found or invite.expires<=clock_timestamp() or invite.failures>=8 then return false; end if;
  if extensions.crypt(pin,invite.pin_hash)<>invite.pin_hash then
    update public.referee_invites set failures=failures+1 where token_hash=hashed;
    return false;
  end if;
  insert into public.referee_access values(t,game,auth.uid(),invite.expires)
  on conflict (tournament_id,match_id,user_id) do update set expires=excluded.expires;
  insert into public.audit_logs(tournament_id,actor,action,match_id) values(t,auth.uid(),'referee_redeem',game);
  return true;
end $$;

create function public.cup_can_report(t uuid, game integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.cup_is_admin(t) or exists(select 1 from public.referee_access where tournament_id=t and match_id=game and user_id=auth.uid() and expires>statement_timestamp())
$$;

create function public.cup_game(t uuid, game integer, expected integer, request uuid, action text, sa integer default null, sb integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare tour public.tournaments; m public.matches; old public.matches; cfg jsonb; pair record; receipt public.audit_logs;
  admin boolean; allowed_draw boolean; ts timestamptz; auto_confirm boolean; seeds jsonb; stage_index integer; official boolean := false;
  home text; away text; ref_team text;
begin
  select * into tour from public.tournaments where id=t for update;
  if not found or tour.state<>'published' then raise exception 'Das Turnier ist für Eingaben geschlossen.'; end if;
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
  if action in ('live','submit','correct') and (sa is null or sb is null or sa not between 0 and 999 or sb not between 0 and 999)
    then raise exception 'Gib je Team eine ganze Punktzahl zwischen 0 und 999 ein.'; end if;
  if action in ('submit','correct') and not allowed_draw and sa=sb then raise exception 'Bei Gleichstand entscheidet der nächste Punkt.'; end if;
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
  elsif action='correct' and m.status in ('submitted','confirmed','corrected') then
    if exists(select 1 from public.matches later join public.stages st on (st.tournament_id,st.id)=(later.tournament_id,later.stage_id)
      where later.tournament_id=t and st.ordinal>stage_index and later.started is not null) then
      raise exception 'Ein Ergebnis einer früheren Phase ist nach Beginn einer Folgephase gesperrt.';
    end if;
    m.status := 'corrected'; m.live_a := sa; m.live_b := sb; official := true;
  else raise exception 'Diese Aktion ist im aktuellen Spielstatus nicht verfügbar.'; end if;
  update public.matches set status=m.status, version=m.version+1, started=m.started, paused=m.paused, paused_ms=m.paused_ms,
    regular_ended=m.regular_ended, ended=m.ended, extra=m.extra, live_a=m.live_a, live_b=m.live_b where tournament_id=t and id=game;
  if official then
    insert into public.results values(t,game,m.live_a,m.live_b,ts)
    on conflict (tournament_id,match_id) do update set score_a=excluded.score_a,score_b=excluded.score_b,updated_at=excluded.updated_at;
  end if;
  insert into public.audit_logs(tournament_id,request_id,actor,action,match_id,payload)
    values(t,request,auth.uid(),action,game,jsonb_build_object('from',old.status,'to',m.status,
    'before',jsonb_build_array(old.live_a,old.live_b),'after',jsonb_build_array(m.live_a,m.live_b),
    'input',jsonb_build_array(sa,sb),'previousVersion',expected));
  perform public.cup_touch(t);
  return m.version+1;
end $$;

create function public.cup_move(t uuid, game integer, expected integer, field text, slot integer, ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare tour public.tournaments; m public.matches; current_pair record; cfg jsonb; st jsonb; mode text;
begin
  if not public.cup_is_admin(t) then raise exception 'Keine Verwaltungsberechtigung.'; end if;
  select * into tour from public.tournaments where id=t for update;
  if tour.state='archived' or tour.revision is distinct from expected then raise exception 'Spielplan ist gesperrt oder veraltet.'; end if;
  select * into m from public.matches where tournament_id=t and id=game;
  if not found or m.status<>'scheduled' or m.version<>0 then raise exception 'Nur unbegonnene Spiele können verschoben werden.'; end if;
  if not exists(select 1 from public.slots where tournament_id=t and id=slot and stage_id=m.stage_id) then raise exception 'Wähle einen vorhandenen Slot derselben Phase.'; end if;
  if exists(select 1 from public.matches where tournament_id=t and slot_id=slot and version>0) then raise exception 'Der Zielslot wurde bereits begonnen.'; end if;
  select configuration into cfg from public.tournament_configurations where tournament_id=t and version=tour.configuration_version;
  select value into st from jsonb_array_elements(cfg->'stages') where value->>'id'=m.stage_id;
  mode := cfg->>'referee';
  if ref is null and mode<>'none' then raise exception 'Pfeif-Team fehlt.'; end if;
  if mode='group' and m.group_id is not null and (
    not exists(select 1 from public.stage_entries where tournament_id=t and group_id=m.group_id and seed=ref)
    or (st->>'kind'='balanced' and (st->>'rounds')::integer>0 and exists(
      select 1 from public.cup_pairs p where p.tournament_id=t and p.group_id=m.group_id and p.round=m.round and ref in (p.a,p.b)))
  ) then raise exception 'Das Pfeif-Team muss in der Gruppe beziehungsweise Runde spielfrei sein.'; end if;
  if (st->>'rounds')::integer>0 and exists(
    select 1 from public.matches other where other.tournament_id=t and other.stage_id=m.stage_id and other.id<>game
      and ((other.round<m.round and other.slot_id>=slot) or (other.round>m.round and other.slot_id<=slot))
  ) then raise exception 'Der Zielslot gehört einer anderen logischen Runde.'; end if;
  select * into current_pair from public.cup_pairs where tournament_id=t and id=game;
  delete from public.referee_access where tournament_id=t and match_id=game;
  delete from public.referee_invites where tournament_id=t and match_id=game;
  delete from public.match_assignments where tournament_id=t and match_id=game;
  update public.matches set court_id=field,slot_id=slot where tournament_id=t and id=game;
  insert into public.match_assignments values(t,game,slot,m.stage_id,current_pair.a,'a'),(t,game,slot,m.stage_id,current_pair.b,'b');
  if ref is not null then insert into public.match_assignments values(t,game,slot,m.stage_id,ref,'referee'); end if;
  insert into public.audit_logs(tournament_id,actor,action,match_id,payload) values(t,auth.uid(),'move',game,
    jsonb_build_object('previousSlot',m.slot_id,'slot',slot,'previousField',m.court_id,'field',field,'previousReferee',current_pair.referee,'referee',ref));
  perform public.cup_touch(t);
exception when unique_violation then raise exception 'Team oder Spielfeld ist im Zielslot bereits belegt.';
end $$;

do $$
declare fn record;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and left(p.proname,4)='cup_'
  loop
    execute format('revoke all on function %s from public, anon, authenticated',fn.signature);
  end loop;
end $$;
grant execute on function public.cup_is_admin(uuid), public.cup_read(uuid) to anon, authenticated;
grant execute on function public.cup_list(), public.cup_audit(uuid), public.cup_save_plan(uuid,integer,jsonb,jsonb),
  public.cup_control(uuid,integer,text), public.cup_issue_ref(uuid,integer), public.cup_redeem_ref(uuid,integer,text,text),
  public.cup_can_report(uuid,integer), public.cup_game(uuid,integer,integer,uuid,text,integer,integer),
  public.cup_move(uuid,integer,integer,text,integer,text) to authenticated;
