# 시세 데이터 수집 (fetch_market.py)

매매일지 종목·날짜별 KRX 실제 시세(OHLCV·전일대비 등락률·갭·상한가 마감 판정·코스피/코스닥 지수)를
수집해 Supabase `market_data` 테이블에 저장한다. 매매일지 AI 분석에서 차트 판독보다 우선하는 확정 사실로 활용.

## 사전 준비 (1회)
- 파이썬 + `pip install finance-datareader`
- Supabase에 테이블 생성:
  ```sql
  CREATE TABLE market_data (
    stock TEXT NOT NULL, date TEXT NOT NULL, code TEXT, data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (stock, date)
  );
  ALTER TABLE market_data DISABLE ROW LEVEL SECURITY;
  ```

## 실행
```bash
python scripts/fetch_market.py test     # 검증(로컬 출력만, 업로드 안 함)
python scripts/fetch_market.py upload    # Supabase 업로드
```
새 매매를 추가한 뒤 `upload`로 다시 돌리면 신규 종목·날짜만 갱신된다(기존은 merge-duplicates).

## 참고
- pykrx 대신 FinanceDataReader 사용(지수·종목리스트 엔드포인트가 더 안정적).
- 상장폐지/명칭변경 종목은 매칭 실패(그 매매는 시세 없이 차트로만 분석).
