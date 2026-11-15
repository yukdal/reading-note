-- 읽기 전용 점검. 초기화 SQL 적용 전후에 실행할 수 있다.
-- 아래 결과는 기존 행을 생성·수정·삭제하지 않는다.

-- 적용 전: 두 테이블이 모두 없으면 새 프로젝트용 초기화 후보.
-- 이미 있으면 0001_init.sql을 재실행하지 말고 현재 구조와 먼저 비교한다.
select expected.name as table_name,
       c.oid is not null as exists,
       c.relrowsecurity as rls_enabled,
       case when c.oid is not null then has_table_privilege('anon', c.oid, 'SELECT') end as anon_can_select,
       case when c.oid is not null then has_table_privilege('authenticated', c.oid, 'SELECT') end as authenticated_can_select,
       case when c.oid is not null then
         has_table_privilege('authenticated', c.oid, 'INSERT')
         or has_table_privilege('authenticated', c.oid, 'UPDATE')
         or has_table_privilege('authenticated', c.oid, 'DELETE')
       end as authenticated_can_write_directly
from (values ('books'), ('mindmaps')) as expected(name)
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = expected.name
order by expected.name;
-- 적용 후 기대: exists=t, rls_enabled=t, anon_can_select=f,
-- authenticated_can_select=t, authenticated_can_write_directly=f.

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('validate_mindmap_nodes', 'normalize_book_input', 'create_book',
                    'save_mindmap', 'update_book', 'delete_book',
                    'export_snapshot', 'export_backup', 'import_backup')
order by p.proname;
-- 내부 검증 함수는 외부 역할 모두 실행 불가.
-- export_backup은 service_role만 실행 가능.
-- 나머지 앱 함수는 authenticated만 실행 가능.
-- SECURITY DEFINER 함수는 고정된 빈 search_path를 사용.

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('books', 'mindmaps')
order by tablename, policyname;
-- 적용 후 본인 user_id만 SELECT하는 정책 두 개.

select count(*) as login_account_count from auth.users;
-- 개인용 프로젝트는 본인 로그인 계정 한 개만 준비한다.