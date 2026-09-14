-- 흐름 멀티분석 결과 저장 테이블 (기기 간 동기화용)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 실행 전에도 앱은 동작합니다(흐름분석은 화면에만 표시). 실행 후부터 저장·목록·동기화됩니다.

create table if not exists flow_reviews (
  id         bigint generated always as identity primary key,
  title      text,                       -- 종목·기간 요약
  trade_ids  text,                       -- 콤마 구분 매매 id
  content    text,                       -- 흐름분석 리포트(마크다운, LECS 마커 포함 가능)
  created_at timestamptz default now()
);

alter table flow_reviews enable row level security;

drop policy if exists flow_reviews_all on flow_reviews;
create policy flow_reviews_all on flow_reviews
  for all to anon using (true) with check (true);
