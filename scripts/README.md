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
  -- RLS는 scripts/secure_rls.sql로 로그인 사용자만 허용(수집 스크립트는 service_role 키 사용)
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

## NXT(넥스트레이드) 보정 — `nxt_kiwoom.py`
KRX 일봉은 전일 애프터마켓(15:30~20:00)·당일 프리마켓(08:00~08:50)을 모르기 때문에, 애프터에서 크게 움직인 다음 날은
'KRX 갭'이 실제 직전 가격 대비 흐름과 크게 어긋난다. 키움 REST API의 NXT 1분봉(`종목코드_NX`, ka10080)으로
전일 애프터·당일 프리·당일 애프터 시세와 **실질 갭(KRX 시가 ÷ NXT 직전가)**을 계산해 `market_data.data.nxt`와 요약 문장에 추가한다.
분봉이 없는 과거 날짜는 NXT 일봉(ka10081)으로 대체, NXT 미거래 종목은 `{"none": true}` 마커.

- 키: GitHub Secret `KIWOOM_APPKEY` / `KIWOOM_SECRETKEY` (로컬은 루트 `.env`). 없으면 보정만 생략.
- `upload` 실행 때마다 보정 안 된 행을 최대 400건 채움(당일 행은 20:05 이후). 과거 일괄: `python scripts/fetch_market.py nxt`

### 고정 IP 서버에서 실행(키움 허용 IP 필요)
키움 REST API는 허용 IP 등록이 필요해 GitHub Actions에서는 NXT 보정이 안 된다. 오라클 등 고정 IP 서버에서:
`curl -sL https://raw.githubusercontent.com/croxian/trading-journal/main/scripts/server/setup_oracle.sh | bash`
→ 매일 20:30 KST `fetch_market.py upload`(KRX 수집 + NXT 보정). 서버 IP를 키움 포털 허용 IP에 등록.
