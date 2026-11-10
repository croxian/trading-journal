-- 🔒 데이터 잠금: 모든 앱 테이블을 '로그인한 사용자만' 읽기/쓰기 가능하게
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요. (여러 번 실행해도 안전)
--
-- 실행 전 확인:
--   1) 앱 로그인 계정이 있다 (Authentication → Users → Add user)
--   2) 시세 수집용 서버 키가 GitHub Secret SUPABASE_SERVICE_KEY 에 들어가 있다
--      (service_role 키는 RLS를 우회하므로 무인 수집·일괄 분석 스크립트는 계속 동작)
--
-- 실행 후: 공개된 anon 키로는 아무 데이터도 읽거나 쓸 수 없다(로그인 세션 토큰이 있어야 함).

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'trades', 'techniques', 'live_trades', 'market_data',
    'analysis_corrections', 'monthly_reviews', 'flow_reviews', 'trade_sets'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice '테이블 없음(건너뜀): %', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    -- 기존 정책(anon 전체 허용 등) 모두 제거
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    -- 로그인 사용자만 허용
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated', t);
    raise notice '잠금 완료: %', t;
  end loop;
end $$;

-- 확인용: 각 테이블 RLS·정책 상태
select c.relname as table, c.relrowsecurity as rls_on,
       coalesce(string_agg(p.policyname || '→' || array_to_string(p.roles, ','), ', '), '(정책 없음)') as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relname in ('trades','techniques','live_trades','market_data','analysis_corrections','monthly_reviews','flow_reviews','trade_sets')
group by c.relname, c.relrowsecurity
order by c.relname;
