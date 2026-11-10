create function public.cup_touch(t uuid) returns void language sql set search_path = ''
as $$ update public.tournaments set revision=revision+1, updated_at=clock_timestamp() where id=t $$;

create function public.cup_save_plan(t uuid, expected integer, cfg jsonb, plan jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tour public.tournaments; st jsonb; grp jsonb; seed text; item jsonb; m jsonb;
  stage_index integer := 0; stage_key text; group_key text; start_at integer; end_at integer; duration integer;
  swap integer; begin_min integer; close_min integer; ref_mode text; target integer; validation text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Melde dich mit einem Administratorkonto an.'; end if;
  duration := (cfg->>'duration')::integer; swap := (cfg->>'change')::integer; ref_mode := cfg->>'referee'; target := (cfg->>'target')::integer;
  begin_min := extract(hour from (cfg->>'start')::time)*60+extract(minute from (cfg->>'start')::time);
  close_min := extract(hour from (cfg->>'end')::time)*60+extract(minute from (cfg->>'end')::time);
  if coalesce(length(trim(cfg->>'name')),0) not between 1 and 100 or duration not between 1 and 180 or swap not between 0 and 120
     or duration is null or swap is null or coalesce(ref_mode,'') not in ('none','available','group')
     or begin_min is null or close_min is null or begin_min>=close_min
     or coalesce(jsonb_array_length(cfg->'teams'),0) not between 2 and 80 or coalesce(jsonb_array_length(cfg->'courts'),0) not between 1 and 16
     or coalesce(jsonb_array_length(cfg->'stages'),0) not between 1 and 10
     or coalesce(jsonb_array_length(plan->'matches'),0) not between 1 and 1500
     or not exists (select 1 from pg_catalog.pg_timezone_names where name=cfg->>'timezone') then
    raise exception 'Ungültige Turnierkonfiguration.';
  end if;
  if t is null then
    insert into public.tournaments(name,day) values (cfg->>'name',(cfg->>'date')::date) returning * into tour;
    t := tour.id;
    insert into public.tournament_roles values (t,auth.uid(),'admin');
  else
    if not public.cup_is_admin(t) then raise exception 'Keine Verwaltungsberechtigung.'; end if;
    select * into tour from public.tournaments where id=t for update;
    if tour.revision is distinct from expected then raise exception 'Versionskonflikt. Lade den aktuellen Stand.'; end if;
    if tour.state <> 'draft' or exists(select 1 from public.matches where tournament_id=t and version>0) then
      raise exception 'Der Plan kann nur im Entwurf neu erstellt werden.';
    end if;
    update public.tournaments set name=cfg->>'name',day=(cfg->>'date')::date,configuration_version=configuration_version+1 where id=t returning * into tour;
    delete from public.matches where tournament_id=t;
    delete from public.carry_over where tournament_id=t;
    delete from public.stage_entries where tournament_id=t;
    delete from public.stages where tournament_id=t;
    delete from public.teams where tournament_id=t;
    delete from public.courts where tournament_id=t;
  end if;
  insert into public.tournament_configurations values(t,tour.configuration_version,cfg,now());
  for item in select value from jsonb_array_elements(cfg->'teams') loop
    insert into public.teams values (t,item->>'id',item->>'name');
  end loop;
  for item in select value from jsonb_array_elements(cfg->'courts') loop
    insert into public.courts values (t,item->>'id',item->>'name');
  end loop;
  for st in select value from jsonb_array_elements(cfg->'stages') loop
    stage_key := st->>'id';
    insert into public.stages values(t,stage_key,st->>'name',stage_index);
    for grp in select value from jsonb_array_elements(st->'groups') loop
      group_key := grp->>'id';
      insert into public.groups values(t,group_key,stage_key,grp->>'name');
      for seed in select value from jsonb_array_elements_text(grp->'members') loop
        if left(seed,1)='@' then
          if not exists (
            select 1 from public.groups g join public.stages s on (s.tournament_id,s.id)=(g.tournament_id,g.stage_id)
            where g.tournament_id=t and g.id=substring(split_part(seed,'/',1),2) and s.ordinal<stage_index
            and split_part(seed,'/',2)::integer between 1 and (select count(*) from public.stage_entries where tournament_id=t and group_id=g.id)
          ) then raise exception 'Ungültiger Qualifikationsrang.'; end if;
          insert into public.stage_entries values(t,stage_key,group_key,seed,null,substring(split_part(seed,'/',1),2),split_part(seed,'/',2)::integer);
        else
          insert into public.stage_entries values(t,stage_key,group_key,seed,seed,null,null);
        end if;
      end loop;
    end loop;
    stage_index := stage_index+1;
  end loop;
  for m in select value from jsonb_array_elements(plan->'matches') loop
    stage_key := m->>'stage'; group_key := m->>'group'; start_at := (m->>'start')::integer; end_at := (m->>'end')::integer;
    if start_at<begin_min or end_at+swap>close_min or end_at-start_at<>duration or exists(
      select 1 from jsonb_array_elements(cfg->'breaks') p
      where start_at < extract(hour from (p->>'end')::time)*60+extract(minute from (p->>'end')::time)
      and end_at+swap > extract(hour from (p->>'start')::time)*60+extract(minute from (p->>'start')::time)
    ) then raise exception 'Ein Slot liegt außerhalb des Turnierfensters.'; end if;
    insert into public.slots values (t,stage_key,(m->>'slot')::integer,start_at,end_at) on conflict (tournament_id,id) do nothing;
    if not exists(select 1 from public.slots s where s.tournament_id=t and s.id=(m->>'slot')::integer and s.start_min=start_at and s.stage_id=stage_key)
      then raise exception 'Widersprüchlicher Slot.'; end if;
    insert into public.matches(tournament_id,id,stage_id,group_id,court_id,slot_id,round)
      values (t,(m->>'id')::integer,stage_key,group_key,m->>'court',(m->>'slot')::integer,(m->>'round')::integer);
    insert into public.match_assignments values(t,(m->>'id')::integer,(m->>'slot')::integer,stage_key,m->>'a','a'),
      (t,(m->>'id')::integer,(m->>'slot')::integer,stage_key,m->>'b','b');
    if m->>'referee' is not null then
      insert into public.match_assignments values(t,(m->>'id')::integer,(m->>'slot')::integer,stage_key,m->>'referee','referee');
    elsif ref_mode<>'none' then raise exception 'Pfeif-Team fehlt.'; end if;
    if group_key is not null and exists(
      select 1 from public.match_assignments a join public.stage_entries e using(tournament_id,stage_id,seed)
      where a.tournament_id=t and a.match_id=(m->>'id')::integer and e.group_id<>group_key and (a.position<>'referee' or ref_mode='group')
    ) then raise exception 'Ungültige Gruppenzuordnung.'; end if;
  end loop;
  if exists (
    select 1 from (
      select s.start_min as start_time, lag(s.end_min) over(order by s.id) as previous_end,
        st.ordinal, lag(st.ordinal) over(order by s.id) as previous_stage,
        coalesce((cfg->'stages'->st.ordinal->>'gap')::integer,0) as gap
      from public.slots s join public.stages st on (st.tournament_id,st.id)=(s.tournament_id,s.stage_id) where s.tournament_id=t
    ) x where ordinal<previous_stage or start_time<coalesce(previous_end+swap,begin_min)+case when ordinal is distinct from previous_stage then gap else 0 end
  ) then raise exception 'Slots oder Phasen überschneiden sich.'; end if;
  for item in select value from jsonb_array_elements(plan->'carry') loop
    insert into public.carry_over values(t,item->>'group',item->>'source',least(item->>'a',item->>'b'),greatest(item->>'a',item->>'b'));
  end loop;
  with pairs as (
    select m.stage_id, m.group_id, least(a.seed,b.seed) a, greatest(a.seed,b.seed) b
    from public.matches m join public.match_assignments a on (a.tournament_id,a.match_id,a.position)=(m.tournament_id,m.id,'a')
    join public.match_assignments b on (b.tournament_id,b.match_id,b.position)=(m.tournament_id,m.id,'b') where m.tournament_id=t
  )
  select case
    when exists(select 1 from pairs group by stage_id,a,b having count(*)>1) then 'Eine Paarung kommt mehrfach vor.'
    when exists(select 1 from pairs p join public.carry_over c on c.tournament_id=t and c.a=p.a and c.b=p.b
      join public.groups g on (g.tournament_id,g.id)=(c.tournament_id,c.group_id) and g.stage_id=p.stage_id)
      then 'Eine übernommene Begegnung darf nicht wiederholt werden.'
    when target is not null and (select count(*) from pairs)*2<>target*jsonb_array_length(cfg->'teams') then 'Die Gesamtzahl der Spiele stimmt nicht mit der Zielspielzahl überein.'
  end into validation;
  if validation is not null then raise exception '%',validation; end if;
  perform public.cup_validate_saved_plan(t,cfg);
  perform public.cup_touch(t);
  insert into public.audit_logs(tournament_id,actor,action,payload) values(t,auth.uid(),'plan',jsonb_build_object('configurationVersion',tour.configuration_version));
  return t;
end $$;
