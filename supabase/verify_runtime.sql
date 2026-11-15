-- 실제 프로젝트에서 저장·충돌·소유권 검사를 하고 임시 기록을 모두 되돌린다.
-- Supabase SQL Editor 관리자 역할에서 전체를 한 번에 실행한다.
-- 본인 로그인 계정이 정확히 1개인 개인용 프로젝트만 대상으로 한다.
BEGIN;
DO $checks$
DECLARE
  owner_id uuid;
  test_book_id uuid := gen_random_uuid();
  first_result jsonb;
  stale_result jsonb;
  nodes jsonb;
BEGIN
  IF (SELECT count(*) FROM auth.users) <> 1 THEN
    RAISE EXCEPTION '개인용 로그인 계정이 정확히 1개인 프로젝트에서만 검증합니다.';
  END IF;
  SELECT id INTO owner_id FROM auth.users;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true);

  first_result := public.create_book(test_book_id,
    '{"title":"[트랜잭션 검증용] 임시 책","status":"want"}'::jsonb);
  IF first_result->>'status' <> 'ok' THEN RAISE EXCEPTION '책 생성 검증 실패'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.mindmaps WHERE book_id=test_book_id) THEN
    RAISE EXCEPTION '책과 맵 동시 생성 실패';
  END IF;

  nodes := jsonb_build_array(
    jsonb_build_object('id','runtime-root','parentId',NULL,'text','[트랜잭션 검증용] 임시 책',
      'color','#4a6fa5','collapsed',false,'order',0),
    jsonb_build_object('id','runtime-child','parentId','runtime-root','text','먼저 저장한 내용',
      'color','#6ec6f0','collapsed',false,'order',0)
  );
  first_result := public.save_mindmap(test_book_id,1,nodes);
  IF first_result->>'status' <> 'ok' OR (first_result->>'version')::int <> 2 THEN
    RAISE EXCEPTION '맵 저장 및 버전 증가 검증 실패';
  END IF;
  stale_result := public.save_mindmap(test_book_id,1,
    jsonb_set(nodes,'{1,text}','"오래된 화면의 수정"'::jsonb));
  IF stale_result->>'status' <> 'conflict' OR (stale_result->>'version')::int <> 2 THEN
    RAISE EXCEPTION '오래된 버전 충돌 검증 실패';
  END IF;
  IF (SELECT data->'nodes'->1->>'text' FROM public.mindmaps WHERE book_id=test_book_id)
     <> '먼저 저장한 내용' THEN
    RAISE EXCEPTION '충돌한 저장이 최신 내용을 덮어썼습니다.';
  END IF;

  -- 다른 주체의 소유권 검사를 검증한다. 실제 추가 계정/토큰은 만들지 않는다.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub',gen_random_uuid()::text,'role','authenticated')::text,true);
  BEGIN
    PERFORM public.save_mindmap(test_book_id,2,nodes);
    RAISE EXCEPTION '다른 주체의 쓰기가 차단되지 않았습니다.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims','{}',true);
  BEGIN
    PERFORM public.save_mindmap(test_book_id,2,nodes);
    RAISE EXCEPTION '비로그인 함수 호출이 차단되지 않았습니다.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF has_table_privilege('anon','public.books','SELECT')
     OR has_table_privilege('authenticated','public.books','INSERT')
     OR has_table_privilege('authenticated','public.mindmaps','UPDATE')
     OR has_function_privilege('anon','public.create_book(uuid,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.export_backup()','EXECUTE') THEN
    RAISE EXCEPTION '외부 역할 권한 검증 실패';
  END IF;
END;
$checks$;
ROLLBACK;