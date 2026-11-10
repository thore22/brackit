alter table public.tournaments
  add column colors jsonb;

create function public.cup_set_colors(t uuid, expected integer, brand text, canvas text) returns void
language plpgsql security definer set search_path = '' as $$
declare palette jsonb;
begin
  if not public.cup_is_admin(t) then raise exception 'Keine Verwaltungsberechtigung.'; end if;
  if brand is null or canvas is null or brand !~ '^#[0-9a-fA-F]{6}$' or canvas !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Wähle zwei gültige Farben.';
  end if;
  palette := jsonb_build_object('primary', lower(brand), 'background', lower(canvas));
  update public.tournaments
    set colors = palette, revision = revision + 1
    where id = t and revision = expected;
  if not found then raise exception 'Versionskonflikt. Prüfe den aktuellen Turnierstand.'; end if;
  insert into public.audit_logs(tournament_id,actor,action,payload)
    values(t,auth.uid(),'colors',palette);
end $$;
revoke all on function public.cup_set_colors(uuid,integer,text,text) from public, anon, authenticated;
grant execute on function public.cup_set_colors(uuid,integer,text,text) to authenticated;


create or replace function public.cup_read(t uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare tour public.tournaments; cfg jsonb; admin boolean;
begin
  select * into tour from public.tournaments where id=t;
  admin := public.cup_is_admin(t);
  if not found or tour.id is null or (tour.state='draft' and not admin) then raise exception 'Turnier nicht verfügbar.'; end if;
  select configuration into cfg from public.tournament_configurations where tournament_id=t and version=tour.configuration_version;
  return jsonb_build_object(
    'id',t,'revision',tour.revision,'configurationVersion',tour.configuration_version,'state',tour.state,'released',tour.released,
    'admin',admin,'colors',tour.colors,'config',cfg,'serverNow',statement_timestamp(),'seeds',public.cup_qualified(t,cfg),
    'plan',jsonb_build_object(
      'matches',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'stage',p.stage_id,'group',p.group_id,'a',p.a,'b',p.b,'referee',p.referee,
        'court',p.court_id,'slot',p.slot_id,'round',p.round,'start',s.start_min,'end',s.end_min) order by p.id)
        from public.cup_pairs p join public.slots s on (s.tournament_id,s.id)=(p.tournament_id,p.slot_id) where p.tournament_id=t),'[]'),
      'carry',coalesce((select jsonb_agg(jsonb_build_object('group',group_id,'source',source_group,'a',a,'b',b)) from public.carry_over where tournament_id=t),'[]')
    ),
    'games',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'version',m.version,'status',m.status,
      'started',m.started,'paused',m.paused,'pausedMs',m.paused_ms,'ended',m.ended,'regularEnded',m.regular_ended,'extra',m.extra,
      'live',case when m.live_a is not null then jsonb_build_object('a',m.live_a,'b',m.live_b) end,
      'official',case when r.score_a is not null then jsonb_build_object('a',r.score_a,'b',r.score_b) end) order by m.id)
      from public.matches m left join public.results r on (r.tournament_id,r.match_id)=(m.tournament_id,m.id) where m.tournament_id=t),'[]')
  );
end $$;
