-- Check submitted plans in the same transaction that replaces the draft.
create function public.cup_validate_saved_plan(t uuid,cfg jsonb) returns void
language plpgsql set search_path = '' as $$
declare st record; grp record; member record; placed record; hist integer[]; origin jsonb; stage_rules jsonb; rules jsonb := cfg->'rules';
  counts jsonb := '{}'; group_history jsonb := '{}'; replaced jsonb := '{}'; started_ranking boolean := false;
  wanted integer := (cfg->>'target')::integer; logical_rounds integer; seed_count integer; games_count integer;
begin
  select coalesce(jsonb_object_agg(id,0),'{}') into counts from public.teams where tournament_id=t;
  if coalesce(rules->>'primary','') not in ('total','average','auto')
    or coalesce(jsonb_typeof(rules->'allowDraw'),'')<>'boolean' or coalesce(jsonb_typeof(rules->'autoConfirm'),'')<>'boolean'
    or coalesce((rules->>'win')::int,-1) not between 0 and 100 or coalesce((rules->>'loss')::int,-1) not between 0 and 100
    or coalesce((rules->>'draw')::int,-1) not between 0 and 100 or coalesce(jsonb_typeof(rules->'tie'),'')<>'array'
    or exists(select 1 from jsonb_array_elements_text(rules->'tie') k where k not in ('quotient','difference','headToHead','scored','draw'))
    or (select count(*)<>count(distinct k) from jsonb_array_elements_text(rules->'tie') k)
    or (wanted is not null and wanted not between 1 and 80)
  then raise exception 'Ungültige Wertungsregeln oder Zielspielzahl.'; end if;
  if exists (
    select 1 from (select id,name from public.teams where tournament_id=t union all select id,name from public.courts where tournament_id=t
      union all select id,name from public.groups where tournament_id=t union all select id,name from public.stages where tournament_id=t) x
    where id !~ '^[a-z0-9_-]{1,48}$' or length(trim(name)) not between 1 and 100
  ) then raise exception 'Kennungen und Namen müssen gültig sein.'; end if;
  if exists(select 1 from public.stage_entries where tournament_id=t and source_group is not null group by seed having count(*)>1) then
    raise exception 'Ein Qualifikationsrang wurde mehrfach verwendet.';
  end if;
  if exists (
    select 1 from public.carry_over c
    left join public.stage_entries a on a.tournament_id=t and a.group_id=c.group_id and a.seed=c.a and a.source_group=c.source_group
    left join public.stage_entries b on b.tournament_id=t and b.group_id=c.group_id and b.seed=c.b and b.source_group=c.source_group
    join public.stages s on (s.tournament_id,s.id)=(a.tournament_id,a.stage_id)
    where c.tournament_id=t and (a.seed is null or b.seed is null or not coalesce((cfg->'stages'->s.ordinal->>'carry')::boolean,false))
  ) or exists (
    select 1 from public.carry_over c where c.tournament_id=t and (
      not exists(select 1 from public.stage_entries a where a.tournament_id=t and a.group_id=c.group_id and a.seed=c.a and a.source_group=c.source_group)
      or not exists(select 1 from public.stage_entries b where b.tournament_id=t and b.group_id=c.group_id and b.seed=c.b and b.source_group=c.source_group)
    )
  ) then raise exception 'Ungültige Ergebnisübernahme.'; end if;

  for st in select * from public.stages where tournament_id=t order by ordinal loop
    stage_rules := cfg->'stages'->st.ordinal;
    logical_rounds := (stage_rules->>'rounds')::integer;
    if coalesce(stage_rules->>'kind','') not in ('roundRobin','balanced','manual') or logical_rounds is null or logical_rounds not between 0 and 80
      or (stage_rules->>'kind'='balanced' and wanted is null) then raise exception 'Ungültiges Turniersystem oder ungültige Rundenzahl.'; end if;
    if not exists(select 1 from public.matches where tournament_id=t and stage_id=st.id) then raise exception 'Eine Phase enthält keine Begegnungen.'; end if;
    if exists(select 1 from public.stage_entries where tournament_id=t and stage_id=st.id and source_group is not null) then
      started_ranking := true;
    end if;
    if started_ranking and exists(select 1 from public.stage_entries where tournament_id=t and stage_id=st.id and team_id is not null) then
      raise exception 'Nach Beginn der Qualifikation müssen Teilnehmer über Rangplätze gewählt werden.';
    end if;
    if logical_rounds>0 and (
      exists(select 1 from public.matches where tournament_id=t and stage_id=st.id and group_id is not null and round>logical_rounds)
      or exists(select 1 from public.matches where tournament_id=t and stage_id=st.id and group_id is null and round<=logical_rounds)
      or (select count(distinct round) from public.matches where tournament_id=t and stage_id=st.id and group_id is not null)<>logical_rounds
      or exists(select 1 from public.matches where tournament_id=t and stage_id=st.id group by slot_id having count(distinct round)>1)
      or exists(select 1 from public.matches m join public.matches earlier on earlier.tournament_id=t and earlier.stage_id=st.id
        where m.tournament_id=t and m.stage_id=st.id and earlier.slot_id<m.slot_id and earlier.round>m.round)
      or exists(select 1 from public.matches m join public.match_assignments a on (a.tournament_id,a.match_id)=(m.tournament_id,m.id)
        where m.tournament_id=t and m.stage_id=st.id and m.group_id is not null and a.position in ('a','b') group by m.round,a.seed having count(*)>1)
      or ((cfg->>'referee')='group' and stage_rules->>'kind'='balanced' and exists(
        select 1 from public.cup_pairs p join public.cup_pairs other on other.tournament_id=t and other.group_id=p.group_id and other.round=p.round
        where p.tournament_id=t and p.stage_id=st.id and p.referee in (other.a,other.b)))
    ) then raise exception 'Konflikt in den logischen Runden oder beim Freilos.'; end if;
    if coalesce((stage_rules->>'carry')::boolean,false) and exists(
      select 1 from public.cup_pairs p join public.stage_entries a on (a.tournament_id,a.stage_id,a.seed)=(p.tournament_id,p.stage_id,p.a)
      join public.stage_entries b on (b.tournament_id,b.stage_id,b.seed)=(p.tournament_id,p.stage_id,p.b)
      where p.tournament_id=t and p.stage_id=st.id and a.source_group=b.source_group
    ) then raise exception 'Bei aktiver Übernahme dürfen gemeinsame Vorrundenspiele nicht wiederholt werden.'; end if;

    for grp in select * from public.groups where tournament_id=t and stage_id=st.id loop
      hist := array[]::integer[];
      select count(*) into games_count from public.matches where tournament_id=t and group_id=grp.id;
      select count(*) into seed_count from public.stage_entries where tournament_id=t and group_id=grp.id;
      if seed_count not between 2 and 32 then raise exception 'Eine Gruppe benötigt zwei bis 32 Teilnehmer.'; end if;
      if stage_rules->>'kind'='roundRobin' and games_count+
        (select count(*) from public.carry_over where tournament_id=t and group_id=grp.id)<>seed_count*(seed_count-1)/2 then
        raise exception 'Eine Jeder-gegen-jeden-Gruppe enthält eine unvollständige Paarungsliste.';
      end if;
      if coalesce((stage_rules->>'carry')::boolean,false) and exists(
        select 1 from public.stage_entries a join public.stage_entries b on (a.tournament_id,a.group_id,a.source_group)=(b.tournament_id,b.group_id,b.source_group) and a.seed<b.seed
        where a.tournament_id=t and a.group_id=grp.id and not exists(
          select 1 from public.carry_over c where c.tournament_id=t and c.group_id=grp.id and c.a=a.seed and c.b=b.seed
        )
      ) then raise exception 'Eine erforderliche Ergebnisübernahme fehlt.'; end if;
      if exists(select 1 from public.carry_over where tournament_id=t and group_id=grp.id
        and not coalesce((group_history->source_group->>'full')::boolean,false)) then raise exception 'Für die Ergebnisübernahme muss die Quellgruppe vollständig spielen.'; end if;

      for member in select * from public.stage_entries where tournament_id=t and group_id=grp.id loop
        if member.source_group is not null then
          origin := group_history->member.source_group;
          if not coalesce((origin->>'qualifiable')::boolean,false) then raise exception 'Ein Rangplatz benötigt eine Quellgruppe mit ausgetragenen Spielen.'; end if;
          if wanted is not null and not (origin->>'uniform')::boolean then raise exception 'Die Quellgruppe muss für die Zielspielzahl einheitliche bisherige Spielzahlen haben.'; end if;
          counts := counts || jsonb_build_object(member.seed,(origin->>'count')::integer);
          replaced := replaced || jsonb_build_object(member.source_group,true);
        end if;
        select coalesce((counts->>member.seed)::integer,0)+count(*) into seed_count
          from public.match_assignments where tournament_id=t and stage_id=st.id and seed=member.seed and position in ('a','b');
        counts := counts || jsonb_build_object(member.seed,seed_count);
        hist := array_append(hist,seed_count);
      end loop;
      seed_count := cardinality(hist);
      group_history := group_history || jsonb_build_object(grp.id,jsonb_build_object('count',hist[1],
        'uniform',hist[1]=all(hist),'full',games_count=seed_count*(seed_count-1)/2,'qualifiable',games_count>0,'size',seed_count));
    end loop;
  end loop;
  if wanted is not null then
    for grp in select key,value from jsonb_each(group_history) where replaced ? key loop
      for placed in select seed from public.stage_entries where tournament_id=t and group_id=grp.key loop
        counts := counts - placed.seed;
      end loop;
      for place in 1..(grp.value->>'size')::integer loop
        if (grp.value->>'count')::integer<>wanted and not exists(select 1 from public.stage_entries where tournament_id=t and source_group=grp.key and source_rank=place) then
          raise exception 'Ein ausgeschiedener Rangplatz erreicht die Zielspielzahl nicht.';
        end if;
      end loop;
    end loop;
    if exists(select 1 from jsonb_each_text(counts) where value::integer<>wanted) then raise exception 'Ein Team oder Rangplatz erreicht die Zielspielzahl nicht.'; end if;
  end if;
end $$;

revoke all on function public.cup_validate_saved_plan(uuid,jsonb) from public, anon, authenticated;
