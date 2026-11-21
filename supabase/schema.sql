-- 在专用于这两人的 Supabase 项目的 SQL Editor 中以管理员身份执行。
begin;

create schema if not exists memory_private;
revoke all on schema memory_private from public, anon, authenticated;
grant usage on schema memory_private to authenticated;

create table if not exists memory_private.couple (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null references auth.users(id),
  partner_id uuid not null references auth.users(id),
  paired_at timestamptz,
  invite_hash bytea,
  invite_expires timestamptz,
  check (owner_id <> partner_id),
  check ((invite_hash is null) = (invite_expires is null)),
  check (paired_at is null or invite_hash is null)
);

create table if not exists public.memory_records (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('meeting','post','comment','message','anniversary','letter')),
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create index if not exists memory_meeting_posts on public.memory_records ((data->>'meetingId'))
  where kind = 'post';

create table if not exists memory_private.attachments (
  path text primary key,
  record_id uuid not null references public.memory_records(id) on delete cascade
);

create table if not exists memory_private.submissions (
  author_id uuid not null,
  request_id uuid not null,
  record_id uuid not null references public.memory_records(id) on delete cascade,
  payload_hash bytea not null,
  primary key (author_id, request_id)
);

alter table memory_private.couple enable row level security;
alter table memory_private.attachments enable row level security;
alter table memory_private.submissions enable row level security;
alter table public.memory_records enable row level security;
revoke all on memory_private.couple, memory_private.attachments, memory_private.submissions,
  public.memory_records from public, anon, authenticated;
grant select on public.memory_records to authenticated;

-- 由管理员在两位用户创建后调用。身份固定为 Auth UUID，更改邮箱不会转让访问权。
create or replace function memory_private.provision(owner_email text, partner_email text)
returns void language plpgsql set search_path = '' as $$
declare
  first_id uuid;
  second_id uuid;
begin
  select id into strict first_id from auth.users
    where lower(email) = lower(trim(owner_email)) and email_confirmed_at is not null;
  select id into strict second_id from auth.users
    where lower(email) = lower(trim(partner_email)) and email_confirmed_at is not null;
  insert into memory_private.couple(owner_id, partner_id) values (first_id, second_id);
end
$$;

create or replace function public.memory_pair_status()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select case
    when paired_at is not null then 'paired'
    when owner_id = auth.uid() then 'owner'
    when invite_expires > now() then 'invited'
    else 'waiting' end
    from memory_private.couple where auth.uid() in (owner_id, partner_id)), 'denied')
$$;

create or replace function public.memory_create_invite()
returns text language plpgsql security definer set search_path = '' as $$
declare token text := replace(gen_random_uuid()::text, '-', '');
begin
  update memory_private.couple
    set invite_hash = sha256(convert_to(token, 'UTF8')), invite_expires = now() + interval '24 hours'
    where owner_id = auth.uid() and paired_at is null;
  if not found then raise exception '只有尚未配对的邀请人可以生成邀请码'; end if;
  return token;
end
$$;

create or replace function public.memory_accept_invite(code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update memory_private.couple set paired_at = clock_timestamp(), invite_hash = null, invite_expires = null
    where partner_id = auth.uid() and paired_at is null and invite_expires > now()
    and invite_hash = sha256(convert_to(lower(trim(code)), 'UTF8'));
  if not found then raise exception '邀请码无效、已使用或已过期'; end if;
end
$$;

drop policy if exists memory_read_records on public.memory_records;
create policy memory_read_records on public.memory_records for select to authenticated
  using ((select public.memory_pair_status()) = 'paired' and
    (kind <> 'letter' or author_id = (select auth.uid()) or
      data->>'date' < to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM-DD')));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('memory-media', 'memory-media', false, 26214400,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function memory_private.is_attached(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.memory_pair_status() = 'paired'
    and exists (select from memory_private.attachments where path = object_path)
$$;

drop policy if exists memory_upload_media on storage.objects;
create policy memory_upload_media on storage.objects for insert to authenticated with check (
  bucket_id = 'memory-media' and (select public.memory_pair_status()) = 'paired'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}[.](jpg|png|webp|gif|avif|mp4|webm|mov)$'
);

drop policy if exists memory_read_media on storage.objects;
create policy memory_read_media on storage.objects for select to authenticated using (
  bucket_id = 'memory-media' and (select public.memory_pair_status()) = 'paired'
  and (split_part(name, '/', 1) = (select auth.uid())::text or memory_private.is_attached(name))
);

-- 所有增添或移动见面事件的事务都先锁定同一条见面记录，随后读取最新顺序。
create or replace function memory_private.position_post(meeting_id uuid, post_id uuid, before_id uuid)
returns public.memory_records language plpgsql set search_path = '' as $$
declare
  meeting public.memory_records;
  ordered uuid[];
  at_index integer;
begin
  select * into meeting from public.memory_records where id = meeting_id and kind = 'meeting' for update;
  if not found then raise exception '见面记录不存在'; end if;
  with saved as (
    select value, min(ordinality) as position from jsonb_array_elements_text(
      case when jsonb_typeof(meeting.data->'eventOrder') = 'array' then meeting.data->'eventOrder'
        else '[]'::jsonb end
    ) with ordinality group by value
  )
  select array_agg(p.id order by saved.position nulls last,
    coalesce(nullif(left(p.data->>'date',10),''), to_char(p.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD')),
    coalesce(nullif(p.data->>'time',''), substr(p.data->>'date',12,5),''), p.created_at, p.id)
    into ordered from public.memory_records p left join saved on saved.value = p.id::text
    where p.kind = 'post' and p.data->>'meetingId' = meeting_id::text;
  if array_position(ordered, post_id) is null or
    (before_id is not null and array_position(ordered, before_id) is null)
    then raise exception '所选事件不在这次见面中，请刷新后重试'; end if;
  if before_id = post_id then return meeting; end if;
  ordered := array_remove(ordered, post_id);
  if before_id is null then
    ordered := array_append(ordered, post_id);
  else
    at_index := array_position(ordered, before_id);
    ordered := ordered[1:at_index-1] || array[post_id] || ordered[at_index:];
  end if;
  update public.memory_records set data = jsonb_set(data,'{eventOrder}',to_jsonb(ordered))
    where id = meeting_id returning * into meeting;
  return meeting;
end
$$;

create or replace function public.memory_add_record(record_kind text, payload jsonb, request_id uuid)
returns public.memory_records language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  entry public.memory_records;
  submission memory_private.submissions;
  fingerprint bytea := sha256(convert_to(jsonb_build_array(record_kind, payload)::text, 'UTF8'));
  ref jsonb;
  actual_mime text;
  event_date date;
  paths text[] := '{}';
  meeting_id uuid;
  place_event boolean := payload ? 'beforeId';
  before_id uuid;
begin
  if public.memory_pair_status() <> 'paired' then raise exception '请先完成配对'; end if;
  if request_id is null or jsonb_typeof(payload) is distinct from 'object'
    or octet_length(payload::text) > 262144 then raise exception '记录内容无效或过长'; end if;
  -- 同一账号重复提交相同请求只写一条。不同设备生成各自的随机请求编号。
  perform pg_advisory_xact_lock(hashtextextended(actor::text || request_id::text, 0));
  select s.* into submission from memory_private.submissions s
    where s.author_id = actor and s.request_id = memory_add_record.request_id;
  if found then
    if fingerprint <> submission.payload_hash then raise exception '提交编号已用于另一条记录'; end if;
    select * into strict entry from public.memory_records where id = submission.record_id;
    return entry;
  end if;

  if record_kind in ('letter','meeting','anniversary','post') then
    if coalesce(payload->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T([01][0-9]|2[0-3]):[0-5][0-9])?$'
      or (record_kind <> 'post' and length(payload->>'date') <> 10)
      then raise exception '请填写有效日期'; end if;
    event_date := left(payload->>'date',10)::date;
    if to_char(event_date, 'YYYY-MM-DD') <> left(payload->>'date',10) then raise exception '日期无效'; end if;
  end if;
  if record_kind = 'meeting' then payload := payload - 'eventOrder'; end if;
  if record_kind = 'post' and nullif(payload->>'meetingId', '') is not null then
    meeting_id := (payload->>'meetingId')::uuid;
    perform 1 from public.memory_records where kind = 'meeting' and id = meeting_id for update;
    if not found then raise exception '见面记录不存在'; end if;
    payload := jsonb_set(payload, '{meetingId}', to_jsonb(meeting_id));
  end if;
  if place_event then
    if meeting_id is null then raise exception '只能为见面中的事件指定位置'; end if;
    before_id := (payload->>'beforeId')::uuid;
    payload := payload - 'beforeId';
  end if;
  if record_kind = 'comment' and not exists
    (select from public.memory_records where kind = 'post' and id = (payload->>'postId')::uuid)
    then raise exception '帖子不存在'; end if;
  if record_kind in ('message','letter') and
    (jsonb_typeof(payload->'body') is distinct from 'string' or (payload->>'body') !~ '[^[:space:]]')
    then raise exception '请填写正文'; end if;
  if record_kind = 'message' then payload := payload || '{"read":false}'::jsonb; end if;
  if record_kind = 'letter' then
    -- 固定未来信字段。接收方可见的媒体、通知和附件表都不会产生记录。
    if coalesce(payload->'media','[]') <> '[]'::jsonb or
      coalesce(payload->'cover','null') <> 'null'::jsonb then raise exception '未来信仅支持文字'; end if;
    payload := jsonb_strip_nulls(jsonb_build_object('date', payload->>'date',
      'title', payload->>'title', 'body', payload->>'body', 'signature', payload->>'signature', 'read', false));
  end if;

  if payload ? 'media' and jsonb_typeof(payload->'media') <> 'array' then
    raise exception '附件列表无效'; end if;
  for ref in
    select value from jsonb_array_elements(coalesce(payload->'media', '[]'::jsonb))
    union all select payload->'cover' where payload->'cover' <> 'null'::jsonb
  loop
    if record_kind not in ('meeting','post','comment') or
      split_part(coalesce(ref->>'path',''), '/', 1) <> actor::text then raise exception '附件无效'; end if;
    select metadata->>'mimetype' into actual_mime from storage.objects
      where bucket_id = 'memory-media' and name = ref->>'path';
    if actual_mime is null or coalesce(ref->>'type','') not in (actual_mime, split_part(actual_mime,'/',1))
      or ((record_kind = 'comment' or ref = payload->'cover') and actual_mime not like 'image/%')
      then raise exception '附件不存在或格式不匹配'; end if;
    if not (ref->>'path' = any(paths)) then paths := array_append(paths, ref->>'path'); end if;
  end loop;

  insert into public.memory_records(kind, author_id, data) values(record_kind, actor, payload)
    returning * into entry;
  if place_event then perform memory_private.position_post(meeting_id, entry.id, before_id); end if;
  insert into memory_private.attachments(path, record_id) select unnest(paths), entry.id;
  insert into memory_private.submissions values(actor, request_id, entry.id, fingerprint);
  return entry;
end
$$;

create or replace function public.memory_move_post(meeting_id uuid, post_id uuid, before_id uuid, request_id uuid)
returns public.memory_records language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  meeting public.memory_records;
  previous memory_private.submissions;
  fingerprint bytea := sha256(convert_to(jsonb_build_array('move-post', meeting_id, post_id, before_id)::text,'UTF8'));
begin
  if public.memory_pair_status() <> 'paired' then raise exception '请先完成配对'; end if;
  if request_id is null then raise exception '提交编号无效'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || request_id::text, 0));
  select s.* into previous from memory_private.submissions s
    where s.author_id = actor and s.request_id = memory_move_post.request_id;
  if found then
    if previous.payload_hash <> fingerprint then raise exception '提交编号已用于其他操作'; end if;
    select * into strict meeting from public.memory_records where id = previous.record_id;
    return meeting;
  end if;
  meeting := memory_private.position_post(meeting_id, post_id, before_id);
  insert into memory_private.submissions values(actor, request_id, meeting.id, fingerprint);
  return meeting;
end
$$;

create or replace function public.memory_mark_read(message_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.memory_records set data = jsonb_set(data, '{read}', 'true'::jsonb)
    where id = message_id and author_id <> auth.uid()
    and (kind = 'message' or (kind = 'letter' and
      data->>'date' < to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM-DD')))
    and data->'read' is distinct from 'true'::jsonb and public.memory_pair_status() = 'paired'
$$;

create or replace function public.memory_usage()
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum((metadata->>'size')::bigint),0)::bigint from storage.objects
  where bucket_id = 'memory-media' and public.memory_pair_status() = 'paired'
$$;

revoke all on function memory_private.provision(text,text), memory_private.is_attached(text),
  memory_private.position_post(uuid,uuid,uuid), public.memory_move_post(uuid,uuid,uuid,uuid),
  public.memory_pair_status(), public.memory_create_invite(), public.memory_accept_invite(text),
  public.memory_add_record(text,jsonb,uuid), public.memory_mark_read(uuid), public.memory_usage()
  from public, anon, authenticated;
grant execute on function memory_private.is_attached(text), public.memory_pair_status(),
  public.memory_move_post(uuid,uuid,uuid,uuid),
  public.memory_create_invite(), public.memory_accept_invite(text),
  public.memory_add_record(text,jsonb,uuid), public.memory_mark_read(uuid), public.memory_usage()
  to authenticated;

notify pgrst, 'reload schema';
commit;
