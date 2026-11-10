create view public.cup_pairs as
  select m.tournament_id,m.id,m.stage_id,m.group_id,m.court_id,m.slot_id,m.round,a.seed as a,b.seed as b,r.seed as referee
  from public.matches m
  join public.match_assignments a on (a.tournament_id,a.match_id,a.position)=(m.tournament_id,m.id,'a')
  join public.match_assignments b on (b.tournament_id,b.match_id,b.position)=(m.tournament_id,m.id,'b')
  left join public.match_assignments r on (r.tournament_id,r.match_id,r.position)=(m.tournament_id,m.id,'referee');
revoke all on public.cup_pairs from public, anon, authenticated;

create function public.cup_hash(value text) returns bigint language plpgsql immutable strict set search_path = '' as $$
declare result bigint := 2166136261;
begin
  for i in 1..length(value) loop result := ((result # ascii(substr(value,i,1))) * 16777619) & 4294967295; end loop;
  return result;
end $$;

create function public.cup_qualified(t uuid,cfg jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare seeds jsonb := '{}'; grp record; ranked_team text; place integer; games jsonb; rows jsonb; criterion text;
  rules jsonb := cfg->'rules'; primary_rule text; criteria text[];
  win int := (rules->>'win')::int; loss int := (rules->>'loss')::int; draw int := (rules->>'draw')::int;
begin
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
      seeds := seeds || jsonb_build_object('@'||grp.id||'/'||place,ranked_team);
    end loop;
  end loop;
  return seeds;
end $$;

create function public.cup_read(t uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare tour public.tournaments; cfg jsonb; admin boolean;
begin
  select * into tour from public.tournaments where id=t;
  admin := public.cup_is_admin(t);
  if not found or tour.id is null or (tour.state='draft' and not admin) then raise exception 'Turnier nicht verfügbar.'; end if;
  select configuration into cfg from public.tournament_configurations where tournament_id=t and version=tour.configuration_version;
  return jsonb_build_object(
    'id',t,'revision',tour.revision,'configurationVersion',tour.configuration_version,'state',tour.state,'released',tour.released,
    'admin',admin,'config',cfg,'serverNow',statement_timestamp(),'seeds',public.cup_qualified(t,cfg),
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

create function public.cup_list() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'date',t.day,'state',t.state) order by t.day desc,t.name),'[]')
  from public.tournaments t join public.tournament_roles r on r.tournament_id=t.id where r.user_id=auth.uid()
$$;

create function public.cup_audit(t uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.cup_is_admin(t) then raise exception 'Keine Verwaltungsberechtigung.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (
    select action,match_id,actor,payload,created_at from public.audit_logs where tournament_id=t order by created_at desc limit 100
  ) a),'[]');
end $$;
