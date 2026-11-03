-- 세트(같은 날·같은 종목 매매) 정보 저장 테이블
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- 실행 전에도 분석은 동작합니다(세트 흐름은 각 매매 분석 앞에 붙여 저장). 실행 후부터 체결 순서·B/S 배정·세트 흐름이 따로 저장됩니다.

create table if not exists trade_sets (
  key        text primary key,          -- 'YYYY-MM-DD|종목'
  date       text,
  stock      text,
  trade_ids  text,                      -- 체결 순서(차트 B/S로 복원)대로 콤마 구분 매매 id
  markers    jsonb,                     -- [{chart,type:B|S,time,price,trade,trade_id,conf}]
  analysis   text,                      -- 세트 흐름 분석(마크다운, LEC 마커 포함 가능)
  updated_at timestamptz default now()
);

alter table trade_sets enable row level security;

drop policy if exists trade_sets_all on trade_sets;
create policy trade_sets_all on trade_sets
  for all to anon using (true) with check (true);
