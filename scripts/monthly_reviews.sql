-- 월간복기 리포트 저장 테이블 (기기 간 동기화용)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 실행 전에도 앱은 동작합니다(리포트는 브라우저 localStorage에만 저장). 실행 후부터 클라우드 동기화됩니다.

create table if not exists monthly_reviews (
  month      text primary key,          -- 'YYYY-MM'
  content    text,                       -- 복기 리포트(마크다운)
  created_at timestamptz default now()
);

alter table monthly_reviews enable row level security;

-- 앱은 로그인 세션으로 읽기/쓰기 → 로그인 사용자(authenticated)만 허용(secure_rls.sql과 동일한 접근 모델)
drop policy if exists monthly_reviews_all on monthly_reviews;
create policy monthly_reviews_all on monthly_reviews
  for all to authenticated using (true) with check (true);   -- 로그인 사용자만(secure_rls.sql과 동일)
