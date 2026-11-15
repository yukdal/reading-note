-- =====================================================================
-- 독서노트 DB 초기화 (0001_init)
-- 새 Supabase 프로젝트의 SQL Editor 에 이 파일 전체를 붙여넣고 한 번만 실행하세요.
--
-- 설계 요약
--   읽기 : RLS(본인 행만) + authenticated 에게 SELECT 권한만
--   쓰기 : 아래 RPC 함수로만 (테이블 직접 INSERT/UPDATE/DELETE 권한 없음)
--   충돌 : 예외가 아니라 {status:'conflict', ...} 로 돌려주고 아무것도 바꾸지 않음
--
-- 함수가 던지는 예외 코드 (PostgREST 가 HTTP 상태로 바꿔 줍니다)
--   42501 -> 403  로그인 필요 / 내 데이터가 아님
--   22023 -> 400  입력값·맵 구조 검증 실패
--   P0002 -> 404  대상 책 또는 맵이 없음
-- =====================================================================


-- 1) 테이블 -----------------------------------------------------------

create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  author text,
  status text not null default 'want' check (status in ('want','reading','done')),
  rating smallint check (rating between 1 and 5),
  spine_color text not null default '#8b5e3c',
  page_count int,
  cover_url text,
  tags text[] not null default '{}',
  shelf_order int not null default 0,
  started_on date,
  finished_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint books_title_not_blank   check (btrim(title) <> ''),
  constraint books_page_count_positive check (page_count is null or page_count > 0),
  constraint books_spine_color_hex   check (spine_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint books_cover_url_https   check (cover_url is null or cover_url like 'https://%'),
  constraint books_date_order        check (started_on is null or finished_on is null
                                            or started_on <= finished_on),
  -- 왜: mindmaps 의 복합 FK 가 참조할 대상. "맵 주인 = 책 주인" 을 DB가 보장하게 만든다.
  constraint books_id_user_unique    unique (id, user_id)
);

create table public.mindmaps (
  book_id uuid primary key references public.books(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{"nodes":[]}'::jsonb,
  version int not null default 1,
  updated_at timestamptz not null default now(),

  constraint mindmaps_data_has_nodes check (jsonb_typeof(data -> 'nodes') = 'array'),
  constraint mindmaps_version_positive check (version >= 1),
  -- 맵의 user_id 는 책의 user_id 와 반드시 같아야 한다 (DB 강제).
  -- 주의: 그래서 books.user_id 는 바꾸지 않는다 (바꾸려면 on update cascade 가 필요).
  constraint mindmaps_same_owner_as_book
    foreign key (book_id, user_id) references public.books(id, user_id) on delete cascade
);

-- 책장 정렬 / 내보내기 순서용
create index books_shelf_idx on public.books (user_id, shelf_order, created_at, id);
create index mindmaps_user_idx on public.mindmaps (user_id);


-- 2) RLS 와 권한 ------------------------------------------------------

alter table public.books    enable row level security;
alter table public.mindmaps enable row level security;

-- SELECT 정책만 만든다. INSERT/UPDATE/DELETE 정책이 없으므로 직접 쓰기는 RLS 가 막는다.
-- (select auth.uid()) 로 감싸면 행마다 다시 호출되지 않아 빠르다.
create policy books_select_own on public.books
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy mindmaps_select_own on public.mindmaps
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 왜: Supabase 는 public 스키마의 새 테이블·함수에 anon/authenticated 권한을
--     기본 권한(default privileges)으로 자동 부여한다. 명시적으로 되돌린다.
revoke all on table public.books, public.mindmaps from anon, authenticated;
grant select on table public.books, public.mindmaps to authenticated;


-- 3) 내부 함수: 마인드맵 노드 검증 ------------------------------------
-- 클라이언트도 같은 검증을 하지만 서버가 최종 방어선이다.
-- 노드: {id, parentId, text, color:'#RRGGBB', collapsed:bool, order:0부터의 형제 순서}

create or replace function public.validate_mindmap_nodes(p_nodes jsonb, p_title text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total     int;
  v_bad       text;
  v_centers   int;
  v_center_text text;
  v_reachable int;
begin
  if p_nodes is null or jsonb_typeof(p_nodes) <> 'array' then
    raise exception '맵 노드는 JSON 배열이어야 합니다 (nodes must be a JSON array)'
      using errcode = '22023';
  end if;

  v_total := jsonb_array_length(p_nodes);
  if v_total = 0 then
    raise exception '맵에는 중심 노드가 1개 있어야 합니다 (nodes is empty)'
      using errcode = '22023';
  end if;

  -- 3-1) 노드 하나하나의 형식. 첫 번째 잘못된 노드만 알려 준다.
  -- 왜 캐스팅 대신 정규식인가: 숫자가 아닌 값이 들어와도 예외 대신 검증 메시지가 나가게 하려고.
  select format('%s번째 노드 - %s', t.idx, t.msg) into v_bad
  from (
    select e.idx,
           case
             when jsonb_typeof(e.n) <> 'object'
               then '노드가 JSON 객체가 아닙니다'
             when not (e.n ?& array['id','parentId','text','color','collapsed','order'])
               then 'id, parentId, text, color, collapsed, order 키가 모두 있어야 합니다'
             when jsonb_typeof(e.n -> 'id') <> 'string' or btrim(e.n ->> 'id') = ''
               then 'id 는 비어 있지 않은 문자열이어야 합니다'
             when jsonb_typeof(e.n -> 'parentId') not in ('string','null')
               then 'parentId 는 문자열 또는 null 이어야 합니다'
             when jsonb_typeof(e.n -> 'parentId') = 'string' and btrim(e.n ->> 'parentId') = ''
               then 'parentId 는 빈 문자열일 수 없습니다'
             when jsonb_typeof(e.n -> 'text') <> 'string'
               then 'text 는 문자열이어야 합니다'
             when jsonb_typeof(e.n -> 'color') <> 'string' or (e.n ->> 'color') !~ '^#[0-9A-Fa-f]{6}$'
               then 'color 는 #RRGGBB 형식이어야 합니다'
             when jsonb_typeof(e.n -> 'collapsed') <> 'boolean'
               then 'collapsed 는 true/false 여야 합니다'
             when jsonb_typeof(e.n -> 'order') <> 'number' or (e.n ->> 'order') !~ '^[0-9]+$'
               then 'order 는 0 이상의 정수여야 합니다'
             else null
           end as msg
    from jsonb_array_elements(p_nodes) with ordinality as e(n, idx)
  ) t
  where t.msg is not null
  order by t.idx
  limit 1;

  if v_bad is not null then
    raise exception '맵 노드 형식 오류: % (invalid node)', v_bad using errcode = '22023';
  end if;

  -- 3-2) 중복 id
  if exists (
    select 1 from jsonb_array_elements(p_nodes) as e(n)
    group by e.n ->> 'id' having count(*) > 1
  ) then
    raise exception '중복된 노드 id 가 있습니다 (duplicate node id)' using errcode = '22023';
  end if;

  -- 3-3) 중심 노드(parentId null)는 정확히 1개, text 는 책 제목과 같아야 한다
  select count(*) into v_centers
  from jsonb_array_elements(p_nodes) as e(n)
  where jsonb_typeof(e.n -> 'parentId') = 'null';

  if v_centers <> 1 then
    raise exception '중심 노드(parentId null)는 정확히 1개여야 합니다 - 현재 %개 (exactly one root required)', v_centers
      using errcode = '22023';
  end if;

  select e.n ->> 'text' into v_center_text
  from jsonb_array_elements(p_nodes) as e(n)
  where jsonb_typeof(e.n -> 'parentId') = 'null';

  if btrim(v_center_text) <> btrim(coalesce(p_title, '')) then
    raise exception '중심 노드의 text 는 책 제목과 같아야 합니다 (center text must equal the book title)'
      using errcode = '22023';
  end if;

  -- 3-4) 자기 참조
  if exists (
    select 1 from jsonb_array_elements(p_nodes) as e(n)
    where e.n ->> 'parentId' = e.n ->> 'id'
  ) then
    raise exception '자기 자신을 부모로 가리키는 노드가 있습니다 (self-referencing node)'
      using errcode = '22023';
  end if;

  -- 3-5) 없는 부모
  if exists (
    select 1 from jsonb_array_elements(p_nodes) as e(n)
    where jsonb_typeof(e.n -> 'parentId') = 'string'
      and not exists (
        select 1 from jsonb_array_elements(p_nodes) as p(n)
        where p.n ->> 'id' = e.n ->> 'parentId'
      )
  ) then
    raise exception '존재하지 않는 부모를 가리키는 노드가 있습니다 (unknown parentId)'
      using errcode = '22023';
  end if;

  -- 3-6) 순환 / 중심과 끊어진 가지
  -- 왜: 부모 포인터가 1개뿐이므로 "중심에서 도달 가능한 수 = 전체 수" 하나로 둘 다 걸러진다.
  with recursive node as (
    select e.n ->> 'id' as id,
           case when jsonb_typeof(e.n -> 'parentId') = 'null' then null
                else e.n ->> 'parentId' end as parent_id
    from jsonb_array_elements(p_nodes) as e(n)
  ),
  reach as (
    select node.id from node where node.parent_id is null
    union
    select child.id from node as child join reach on child.parent_id = reach.id
  )
  select count(*) into v_reachable from reach;

  if v_reachable <> v_total then
    raise exception '중심 노드에서 이어지지 않는 노드가 있습니다 - 순환 또는 끊어진 가지 (unreachable nodes)'
      using errcode = '22023';
  end if;

  -- 3-7) 같은 부모 안에서 order 는 0 부터 중복 없이 연속
  if exists (
    select 1
    from jsonb_array_elements(p_nodes) as e(n)
    group by e.n -> 'parentId'
    having count(distinct (e.n ->> 'order')::numeric) <> count(*)
        or min((e.n ->> 'order')::numeric) <> 0
        or max((e.n ->> 'order')::numeric) <> count(*) - 1
  ) then
    raise exception 'order 는 같은 부모 안에서 0 부터 중복 없이 연속이어야 합니다 (sibling order must be 0..n-1)'
      using errcode = '22023';
  end if;
end;
$$;


-- 4) 내부 함수: 책 입력 정규화 ----------------------------------------
-- 호출자가 보낸 jsonb 에서 쓸 수 있는 10개 필드만 꺼내 다듬는다.
-- id, user_id, shelf_order, created_at, updated_at 은 서버가 정하므로 비워 둔다.

create or replace function public.normalize_book_input(p_book jsonb)
returns public.books
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.books;
begin
  if p_book is null or jsonb_typeof(p_book) <> 'object' then
    raise exception '책 정보는 JSON 객체여야 합니다 (p_book must be a JSON object)'
      using errcode = '22023';
  end if;

  r.title := nullif(btrim(coalesce(p_book ->> 'title', '')), '');
  if r.title is null then
    raise exception '제목은 비어 있을 수 없습니다 (title is required)' using errcode = '22023';
  end if;

  if p_book ? 'tags' and jsonb_typeof(p_book -> 'tags') not in ('array','null') then
    raise exception 'tags 는 문자열 배열이어야 합니다 (tags must be an array)' using errcode = '22023';
  end if;

  r.author      := nullif(btrim(coalesce(p_book ->> 'author', '')), '');
  r.status      := coalesce(nullif(btrim(coalesce(p_book ->> 'status', '')), ''), 'want');
  r.rating      := nullif(btrim(coalesce(p_book ->> 'rating', '')), '')::numeric::smallint;
  r.spine_color := coalesce(nullif(btrim(coalesce(p_book ->> 'spine_color', '')), ''), '#8b5e3c');
  r.page_count  := nullif(btrim(coalesce(p_book ->> 'page_count', '')), '')::numeric::int;
  r.cover_url   := nullif(btrim(coalesce(p_book ->> 'cover_url', '')), '');
  r.started_on  := nullif(btrim(coalesce(p_book ->> 'started_on', '')), '')::date;
  r.finished_on := nullif(btrim(coalesce(p_book ->> 'finished_on', '')), '')::date;
  r.tags        := coalesce(
    (select array_agg(btrim(x.t) order by x.i)
       from jsonb_array_elements_text(
              case when jsonb_typeof(p_book -> 'tags') = 'array' then p_book -> 'tags'
                   else '[]'::jsonb end
            ) with ordinality as x(t, i)
      where btrim(coalesce(x.t, '')) <> ''),
    '{}'::text[]);

  return r;
end;
$$;


-- 5) create_book ------------------------------------------------------
-- 책 + 중심 노드 1개짜리 맵을 한 트랜잭션에서 만든다.

create or replace function public.create_book(p_id uuid, p_book jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_in       public.books;
  v_row      public.books;
  v_existing public.books;
  v_map_version int;
  v_center   jsonb;
  v_shelf    int;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다 (not authenticated)' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'p_id 가 필요합니다 (p_id is required)' using errcode = '22023';
  end if;

  v_in := public.normalize_book_input(p_book);

  -- 같은 p_id 가 이미 내 책으로 있으면 그대로 돌려준다 (네트워크 재시도 안전).
  select * into v_existing from public.books where id = p_id;
  if found then
    if v_existing.user_id <> v_uid then
      raise exception '다른 사용자의 책 id 입니다 (book id belongs to another user)'
        using errcode = '42501';
    end if;
    select m.version into v_map_version from public.mindmaps m where m.book_id = p_id;
    return jsonb_build_object('status','ok','book', to_jsonb(v_existing),
                              'map_version', v_map_version);
  end if;

  -- 내 책 중 가장 뒤로. 동시에 2권을 만들면 같은 값이 될 수 있는데,
  -- 정렬은 (shelf_order, created_at, id) 로 하므로 순서가 흔들리지는 않는다.
  select coalesce(max(b.shelf_order), -1) + 1 into v_shelf
  from public.books b where b.user_id = v_uid;

  v_center := jsonb_build_object(
    'id',        gen_random_uuid()::text,
    'parentId',  null::text,
    'text',      v_in.title,
    'color',     v_in.spine_color,
    'collapsed', false,
    'order',     0
  );

  begin
    insert into public.books (id, user_id, title, author, status, rating, spine_color,
                              page_count, cover_url, tags, shelf_order,
                              started_on, finished_on, created_at, updated_at)
    values (p_id, v_uid, v_in.title, v_in.author, v_in.status, v_in.rating, v_in.spine_color,
            v_in.page_count, v_in.cover_url, v_in.tags, v_shelf,
            v_in.started_on, v_in.finished_on, now(), now())
    returning * into v_row;

    insert into public.mindmaps (book_id, user_id, data, version, updated_at)
    values (p_id, v_uid, jsonb_build_object('nodes', jsonb_build_array(v_center)), 1, now());
  exception
    when unique_violation then
      -- 같은 id 로 동시에 호출된 경우: 먼저 성공한 쪽 결과를 돌려준다 (중복 생성 없음).
      select * into v_existing from public.books where id = p_id;
      if not found then
        raise;
      end if;
      if v_existing.user_id <> v_uid then
        raise exception '다른 사용자의 책 id 입니다 (book id belongs to another user)'
          using errcode = '42501';
      end if;
      select m.version into v_map_version from public.mindmaps m where m.book_id = p_id;
      return jsonb_build_object('status','ok','book', to_jsonb(v_existing),
                                'map_version', v_map_version);
  end;

  return jsonb_build_object('status','ok','book', to_jsonb(v_row), 'map_version', 1);
end;
$$;


-- 6) save_mindmap -----------------------------------------------------

create or replace function public.save_mindmap(p_book_id uuid, p_expected_version int, p_nodes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_title   text;
  v_version int;
  v_updated timestamptz;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다 (not authenticated)' using errcode = '42501';
  end if;
  if p_expected_version is null then
    raise exception 'p_expected_version 이 필요합니다 (p_expected_version is required)'
      using errcode = '22023';
  end if;

  -- 잠금 순서는 어디서나 책 -> 맵 (교착 방지)
  select b.user_id, b.title into v_owner, v_title
  from public.books b where b.id = p_book_id for update;
  if not found then
    raise exception '책을 찾을 수 없습니다 (book not found)' using errcode = 'P0002';
  end if;
  if v_owner <> v_uid then
    raise exception '내 책이 아닙니다 (not your book)' using errcode = '42501';
  end if;

  select m.version, m.updated_at into v_version, v_updated
  from public.mindmaps m where m.book_id = p_book_id for update;
  if not found then
    raise exception '맵을 찾을 수 없습니다 (mindmap not found)' using errcode = 'P0002';
  end if;

  -- 충돌이면 아무것도 바꾸지 않고 현재 값을 돌려준다 (검증보다 먼저 - 어차피 다시 받아와야 하므로).
  if p_expected_version <> v_version then
    return jsonb_build_object('status','conflict','version', v_version, 'updated_at', v_updated);
  end if;

  perform public.validate_mindmap_nodes(p_nodes, v_title);

  update public.mindmaps m
     set data = jsonb_build_object('nodes', p_nodes),
         version = v_version + 1,
         updated_at = now()
   where m.book_id = p_book_id
  returning m.version, m.updated_at into v_version, v_updated;

  return jsonb_build_object('status','ok','version', v_version, 'updated_at', v_updated);
end;
$$;


-- 7) update_book ------------------------------------------------------
-- 제목이 바뀌면 맵의 중심 노드 text 도 같이 바뀐다 (둘이 함께 반영되거나 함께 취소).

create or replace function public.update_book(
  p_book_id uuid,
  p_expected_updated_at timestamptz,
  p_book jsonb,
  p_expected_map_version int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_cur       public.books;
  v_in        public.books;
  v_row       public.books;
  v_map_version int;
  v_nodes     jsonb;
  v_new_nodes jsonb;
  v_title_changed boolean;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다 (not authenticated)' using errcode = '42501';
  end if;
  if p_expected_updated_at is null then
    raise exception 'p_expected_updated_at 이 필요합니다 (p_expected_updated_at is required)'
      using errcode = '22023';
  end if;

  v_in := public.normalize_book_input(p_book);

  select * into v_cur from public.books where id = p_book_id for update;
  if not found then
    raise exception '책을 찾을 수 없습니다 (book not found)' using errcode = 'P0002';
  end if;
  if v_cur.user_id <> v_uid then
    raise exception '내 책이 아닙니다 (not your book)' using errcode = '42501';
  end if;

  select m.version, m.data -> 'nodes' into v_map_version, v_nodes
  from public.mindmaps m where m.book_id = p_book_id for update;
  if not found then
    raise exception '맵을 찾을 수 없습니다 (mindmap not found)' using errcode = 'P0002';
  end if;

  v_title_changed := v_in.title <> v_cur.title;

  if v_title_changed and p_expected_map_version is null then
    raise exception '제목을 바꿀 때는 p_expected_map_version 이 필요합니다 (map version token required to rename)'
      using errcode = '22023';
  end if;

  -- 보낸 토큰 중 하나라도 어긋나면 충돌 (아무것도 바꾸지 않음)
  if p_expected_updated_at <> v_cur.updated_at
     or (p_expected_map_version is not null and p_expected_map_version <> v_map_version) then
    return jsonb_build_object('status','conflict','book', to_jsonb(v_cur),
                              'map_version', v_map_version);
  end if;

  -- shelf_order, user_id, created_at 은 건드리지 않는다.
  update public.books b
     set title = v_in.title,
         author = v_in.author,
         status = v_in.status,
         rating = v_in.rating,
         spine_color = v_in.spine_color,
         page_count = v_in.page_count,
         cover_url = v_in.cover_url,
         tags = v_in.tags,
         started_on = v_in.started_on,
         finished_on = v_in.finished_on,
         updated_at = now()
   where b.id = p_book_id
  returning * into v_row;

  if v_title_changed then
    select jsonb_agg(
             case when jsonb_typeof(e.n -> 'parentId') = 'null'
                  then jsonb_set(e.n, '{text}', to_jsonb(v_in.title))
                  else e.n end
             order by e.idx)
      into v_new_nodes
      from jsonb_array_elements(v_nodes) with ordinality as e(n, idx);

    perform public.validate_mindmap_nodes(v_new_nodes, v_in.title);

    update public.mindmaps m
       set data = jsonb_build_object('nodes', v_new_nodes),
           version = v_map_version + 1,
           updated_at = now()
     where m.book_id = p_book_id
    returning m.version into v_map_version;
  end if;

  return jsonb_build_object('status','ok','book', to_jsonb(v_row), 'map_version', v_map_version);
end;
$$;


-- 8) delete_book ------------------------------------------------------

create or replace function public.delete_book(
  p_book_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_map_version int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cur public.books;
  v_map_version int;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다 (not authenticated)' using errcode = '42501';
  end if;
  if p_expected_updated_at is null or p_expected_map_version is null then
    raise exception 'p_expected_updated_at 과 p_expected_map_version 이 모두 필요합니다 (both tokens are required)'
      using errcode = '22023';
  end if;

  select * into v_cur from public.books where id = p_book_id for update;
  if not found then
    raise exception '책을 찾을 수 없습니다 (book not found)' using errcode = 'P0002';
  end if;
  if v_cur.user_id <> v_uid then
    raise exception '내 책이 아닙니다 (not your book)' using errcode = '42501';
  end if;

  select m.version into v_map_version
  from public.mindmaps m where m.book_id = p_book_id for update;
  if not found then
    raise exception '맵을 찾을 수 없습니다 (mindmap not found)' using errcode = 'P0002';
  end if;

  if p_expected_updated_at <> v_cur.updated_at or p_expected_map_version <> v_map_version then
    return jsonb_build_object('status','conflict','book', to_jsonb(v_cur),
                              'map_version', v_map_version);
  end if;

  delete from public.books where id = p_book_id;  -- 맵은 on delete cascade 로 함께 삭제
  return jsonb_build_object('status','ok');
end;
$$;


-- 9) export_snapshot --------------------------------------------------
-- SECURITY INVOKER + RLS 로 충분하다 (본인 행만 보인다).
-- 한 문(statement) 이라 한 스냅샷으로 읽는다.

create or replace function public.export_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'books', coalesce((select jsonb_agg(to_jsonb(b) order by b.shelf_order, b.created_at, b.id)
                       from public.books b), '[]'::jsonb),
    'mindmaps', coalesce((select jsonb_agg(to_jsonb(m) order by m.book_id)
                          from public.mindmaps m), '[]'::jsonb)
  );
$$;


-- 10) export_backup ---------------------------------------------------
-- 백업(Apps Script) 전용. service_role 에게만 실행 권한을 준다.

create or replace function public.export_backup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out      jsonb;
  v_users    int;
  v_orphan_books int;
  v_orphan_maps  int;
begin
  -- 한 문으로 다 읽어 두고(한 스냅샷), 검사는 읽어 둔 값으로 한다.
  select jsonb_build_object(
    'books', coalesce((select jsonb_agg(to_jsonb(b) order by b.shelf_order, b.created_at, b.id)
                       from public.books b), '[]'::jsonb),
    'mindmaps', coalesce((select jsonb_agg(to_jsonb(m) order by m.book_id)
                          from public.mindmaps m), '[]'::jsonb)
  ) into v_out;

  select count(distinct t.u) into v_users from (
    select e.v ->> 'user_id' as u from jsonb_array_elements(v_out -> 'books') as e(v)
    union all
    select e.v ->> 'user_id'      from jsonb_array_elements(v_out -> 'mindmaps') as e(v)
  ) t;
  if v_users > 1 then
    raise exception '여러 사용자의 데이터가 섞여 있습니다 - %명 (backup expects a single user)', v_users
      using errcode = '22023';
  end if;

  select count(*) into v_orphan_books from (
    select e.v ->> 'id' from jsonb_array_elements(v_out -> 'books') as e(v)
    except
    select e.v ->> 'book_id' from jsonb_array_elements(v_out -> 'mindmaps') as e(v)
  ) t;
  if v_orphan_books > 0 then
    raise exception '맵이 없는 책이 %권 있습니다 (book without mindmap)', v_orphan_books
      using errcode = '22023';
  end if;

  select count(*) into v_orphan_maps from (
    select e.v ->> 'book_id' from jsonb_array_elements(v_out -> 'mindmaps') as e(v)
    except
    select e.v ->> 'id' from jsonb_array_elements(v_out -> 'books') as e(v)
  ) t;
  if v_orphan_maps > 0 then
    raise exception '책이 없는 맵이 %개 있습니다 (mindmap without book)', v_orphan_maps
      using errcode = '22023';
  end if;

  return v_out;
end;
$$;


-- 11) import_backup ---------------------------------------------------
-- p_books / p_mindmaps : 적용할 책·맵 배열 (파일의 user_id·created_at·updated_at·version 은 무시)
--   맵은 내보낸 형식 그대로 {book_id, data:{nodes:[...]}} 를 기대한다 ({book_id, nodes} 도 받아 준다).
-- p_expected : [{book_id, updated_at, map_version}] - 미리보기 때 이미 있던 대상 책의 토큰.
--   대상(p_books) 밖의 항목은 무시한다.

create or replace function public.import_backup(p_books jsonb, p_mindmaps jsonb, p_expected jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_expected  jsonb := '[]'::jsonb;
  v_ids       uuid[];
  v_existing  uuid[] := '{}';
  v_new_ids   uuid[] := '{}';
  v_conflicts uuid[] := '{}';
  v_count     int;
  v_base      int;
  v_new_rank  int := 0;
  v_added     int := 0;
  v_changed   int := 0;
  v_rec       record;
  v_in        public.books;
  v_nodes     jsonb;
  c_uuid      text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다 (not authenticated)' using errcode = '42501';
  end if;
  if p_books is null or jsonb_typeof(p_books) <> 'array'
     or p_mindmaps is null or jsonb_typeof(p_mindmaps) <> 'array' then
    raise exception 'p_books 와 p_mindmaps 는 JSON 배열이어야 합니다 (arrays required)'
      using errcode = '22023';
  end if;
  if p_expected is not null and jsonb_typeof(p_expected) = 'array' then
    v_expected := p_expected;
  elsif p_expected is not null and jsonb_typeof(p_expected) <> 'null' then
    raise exception 'p_expected 는 JSON 배열이어야 합니다 (array required)' using errcode = '22023';
  end if;

  -- 11-1) 입력 형식 검사 ------------------------------------------------
  if exists (
    select 1 from jsonb_array_elements(p_books) as e(v)
    where coalesce(e.v ->> 'id', '') !~* c_uuid
  ) then
    raise exception '모든 책에 id(uuid) 가 있어야 합니다 (every book needs a uuid id)'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_mindmaps) as e(v)
    where coalesce(e.v ->> 'book_id', '') !~* c_uuid
  ) then
    raise exception '모든 맵에 book_id(uuid) 가 있어야 합니다 (every mindmap needs a uuid book_id)'
      using errcode = '22023';
  end if;

  select array_agg((e.v ->> 'id')::uuid order by e.idx) into v_ids
  from jsonb_array_elements(p_books) with ordinality as e(v, idx);

  if v_ids is null then
    if jsonb_array_length(p_mindmaps) > 0 then
      raise exception '책이 없는 맵이 들어 있습니다 (mindmap without book)' using errcode = '22023';
    end if;
    return jsonb_build_object('status','ok','added',0,'changed',0);
  end if;

  select count(distinct x) into v_count from unnest(v_ids) as x;
  if v_count <> array_length(v_ids, 1) then
    raise exception '파일에 같은 책 id 가 두 번 있습니다 (duplicate book id)' using errcode = '22023';
  end if;

  -- 책 1권 : 맵 1개
  if jsonb_array_length(p_mindmaps) <> array_length(v_ids, 1)
     or (select count(distinct e.v ->> 'book_id') from jsonb_array_elements(p_mindmaps) as e(v))
        <> array_length(v_ids, 1)
     or exists (select 1 from jsonb_array_elements(p_mindmaps) as e(v)
                where not ((e.v ->> 'book_id')::uuid = any(v_ids)))
  then
    raise exception '책 1권마다 맵이 정확히 1개여야 합니다 (each book needs exactly one mindmap)'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_expected) as e(v)
    where coalesce(e.v ->> 'book_id', '') !~* c_uuid
       or e.v ->> 'updated_at' is null
       or e.v ->> 'map_version' is null
  ) then
    raise exception 'p_expected 의 각 항목에는 book_id, updated_at, map_version 이 모두 있어야 합니다'
      using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(v_expected) as e(v))
     <> (select count(distinct e.v ->> 'book_id') from jsonb_array_elements(v_expected) as e(v)) then
    raise exception 'p_expected 에 같은 book_id 가 두 번 있습니다 (duplicate token)' using errcode = '22023';
  end if;

  -- 11-2) 대상 행 잠금: id 오름차순 (여러 책을 다룰 때 교착 방지) ---------
  with locked as (
    select b.id from public.books b where b.id = any(v_ids) order by b.id for update
  )
  select coalesce(array_agg(locked.id order by locked.id), '{}') into v_existing from locked;

  if exists (select 1 from public.books b where b.id = any(v_ids) and b.user_id <> v_uid) then
    raise exception '다른 사용자의 책 id 가 포함되어 있습니다 (book id belongs to another user)'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(x order by x), '{}') into v_new_ids
  from unnest(v_ids) as x where not (x = any(v_existing));

  -- 11-3) 토큰 비교 (잠근 뒤에 읽는 것이 중요) ---------------------------
  -- (a) DB 에 있는데 p_expected 에 없음  (b) 토큰이 다름
  select coalesce(array_agg(b.id order by b.id), '{}') into v_conflicts
  from public.books b
  left join public.mindmaps m on m.book_id = b.id
  left join lateral (
    select (e.v ->> 'updated_at')::timestamptz as updated_at,
           (e.v ->> 'map_version')::int as map_version
    from jsonb_array_elements(v_expected) as e(v)
    where (e.v ->> 'book_id')::uuid = b.id
  ) tok on true
  where b.id = any(v_existing)
    and (tok.updated_at is null
         or tok.updated_at <> b.updated_at
         or tok.map_version is distinct from m.version);

  -- (c) p_expected 에 있는데 지금은 없음
  select v_conflicts || coalesce(array_agg((e.v ->> 'book_id')::uuid), '{}') into v_conflicts
  from jsonb_array_elements(v_expected) as e(v)
  where (e.v ->> 'book_id')::uuid = any(v_ids)
    and not ((e.v ->> 'book_id')::uuid = any(v_existing));

  if array_length(v_conflicts, 1) > 0 then
    select array_agg(distinct c) into v_conflicts from unnest(v_conflicts) as c;
    return jsonb_build_object('status','conflict','book_ids', to_jsonb(v_conflicts));
  end if;

  -- 11-4) 쓰기 ----------------------------------------------------------
  select coalesce(max(b.shelf_order), -1) + 1 into v_base
  from public.books b where b.user_id = v_uid;

  begin
    for v_rec in
      select (e.v ->> 'id')::uuid as id, e.v as book, e.idx as idx
      from jsonb_array_elements(p_books) with ordinality as e(v, idx)
      order by e.idx
    loop
      v_in := public.normalize_book_input(v_rec.book);

      select coalesce(e.v -> 'data' -> 'nodes', e.v -> 'nodes') into v_nodes
      from jsonb_array_elements(p_mindmaps) as e(v)
      where (e.v ->> 'book_id')::uuid = v_rec.id;

      perform public.validate_mindmap_nodes(v_nodes, v_in.title);

      if v_rec.id = any(v_existing) then
        update public.books b
           set title = v_in.title, author = v_in.author, status = v_in.status,
               rating = v_in.rating, spine_color = v_in.spine_color,
               page_count = v_in.page_count, cover_url = v_in.cover_url,
               tags = v_in.tags, started_on = v_in.started_on,
               finished_on = v_in.finished_on, updated_at = now()
         where b.id = v_rec.id;

        update public.mindmaps m
           set data = jsonb_build_object('nodes', v_nodes),
               version = m.version + 1,
               updated_at = now()
         where m.book_id = v_rec.id;

        v_changed := v_changed + 1;
      else
        -- shelf_order 는 파일 값 대신 기존 최댓값 뒤로, 파일 안 순서를 유지
        insert into public.books (id, user_id, title, author, status, rating, spine_color,
                                  page_count, cover_url, tags, shelf_order,
                                  started_on, finished_on, created_at, updated_at)
        values (v_rec.id, v_uid, v_in.title, v_in.author, v_in.status, v_in.rating,
                v_in.spine_color, v_in.page_count, v_in.cover_url, v_in.tags,
                v_base + v_new_rank, v_in.started_on, v_in.finished_on, now(), now());

        insert into public.mindmaps (book_id, user_id, data, version, updated_at)
        values (v_rec.id, v_uid, jsonb_build_object('nodes', v_nodes), 1, now());

        v_new_rank := v_new_rank + 1;
        v_added := v_added + 1;
      end if;
    end loop;
  exception
    when unique_violation then
      -- 미리보기 뒤에 다른 창이 같은 id 를 먼저 만든 경우.
      -- 이 블록 안에서 쓴 내용은 모두 취소되고 충돌로 돌려준다.
      return jsonb_build_object('status','conflict','book_ids', to_jsonb(v_new_ids));
  end;

  return jsonb_build_object('status','ok','added', v_added, 'changed', v_changed);
end;
$$;


-- 12) 함수 실행 권한 --------------------------------------------------
-- 왜: PostgreSQL 은 새 함수에 PUBLIC 실행 권한을 주고, Supabase 는 기본 권한으로
--     anon/authenticated/service_role 에도 준다. 전부 거둬들인 뒤 필요한 것만 준다.

revoke all on function
  public.validate_mindmap_nodes(jsonb, text),
  public.normalize_book_input(jsonb),
  public.create_book(uuid, jsonb),
  public.save_mindmap(uuid, int, jsonb),
  public.update_book(uuid, timestamptz, jsonb, int),
  public.delete_book(uuid, timestamptz, int),
  public.export_snapshot(),
  public.export_backup(),
  public.import_backup(jsonb, jsonb, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_book(uuid, jsonb),
  public.save_mindmap(uuid, int, jsonb),
  public.update_book(uuid, timestamptz, jsonb, int),
  public.delete_book(uuid, timestamptz, int),
  public.export_snapshot(),
  public.import_backup(jsonb, jsonb, jsonb)
to authenticated;

-- 백업 전용
grant execute on function public.export_backup() to service_role;

-- validate_mindmap_nodes / normalize_book_input 은 내부용이라 아무에게도 주지 않는다
-- (SECURITY DEFINER 함수가 소유자 권한으로 호출한다).


-- =====================================================================
-- 실행 후 확인용 쿼리 - SQL Editor 에 하나씩 복사해서 실행해 보세요.
--
-- 1) RLS 가 켜져 있는지 (두 줄 모두 t 여야 함)
--    select relname, relrowsecurity from pg_class
--     where oid in ('public.books'::regclass, 'public.mindmaps'::regclass);
--
-- 2) 테이블 권한 - authenticated 는 SELECT 만, anon 은 한 줄도 없어야 함
--    select grantee, table_name, privilege_type from information_schema.role_table_grants
--     where table_schema = 'public' and table_name in ('books','mindmaps')
--       and grantee in ('anon','authenticated') order by grantee, table_name;
--
-- 3) 비로그인(anon) 조회 거부 - "permission denied for table books" 가 나와야 정상
--    begin; set local role anon; select count(*) from public.books; rollback;
--
-- 4) 로그인 사용자의 직접 쓰기 거부 - "permission denied for table books" 가 나와야 정상
--    begin; set local role authenticated;
--    insert into public.books (title) values ('직접 쓰기'); rollback;
--
-- 5) 함수 설정 - 쓰기 함수는 prosecdef = t, proconfig 에 search_path= 가 보여야 함
--    select proname, prosecdef, proconfig from pg_proc
--     where pronamespace = 'public'::regnamespace order by proname;
--
-- (참고) 로그인한 것처럼 흉내내서 RPC 를 시험해 보려면:
--    begin;
--      set local role authenticated;
--      set local request.jwt.claims = '{"sub":"<auth.users 에 있는 uuid>","role":"authenticated"}';
--      select public.create_book(gen_random_uuid(), '{"title":"테스트"}'::jsonb);
--    rollback;
-- =====================================================================
