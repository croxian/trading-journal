# 매매일지 종목·날짜별 시장 데이터(OHLCV·상한가·갭·등락률 + 지수) 수집
# FinanceDataReader 사용 (pykrx보다 안정적). Supabase market_data 테이블에 저장.
#   python fetch_market.py test        # 검증(로컬 출력만, 업로드 안 함)
#   python fetch_market.py upload       # 신규(미수집) 종목·날짜만 수집 -> 업로드  ← 매일 자동 실행용
#   python fetch_market.py upload all   # 전체 재수집(강제)
import json, datetime as dt, sys, os, re, urllib.request
import FinanceDataReader as fdr

SB_URL = "https://vbdtrynddjryxcpgpisf.supabase.co"
SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiZHRyeW5kZGpyeXhjcGdwaXNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDI0MDEsImV4cCI6MjA5NTk3ODQwMX0.p3Bs8i-sNz6GodYIXLg1BzdrTxAc9-jB2dZRaOKCW3M"
HDR = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}
BASE = os.path.dirname(os.path.abspath(__file__))

def sb_get(path):
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{path}", headers=HDR)
    return json.load(urllib.request.urlopen(req))

def sb_upsert(rows):
    h = {**HDR, "Prefer": "resolution=merge-duplicates,return=minimal"}
    req = urllib.request.Request(f"{SB_URL}/rest/v1/market_data", data=json.dumps(rows).encode(), headers=h, method="POST")
    urllib.request.urlopen(req)

MODE = sys.argv[1] if len(sys.argv) > 1 else "test"
FORCE_ALL = (len(sys.argv) > 2 and sys.argv[2] == "all")

# ── 신규상장 공모가(=상장일 기준가) 수집: 38커뮤니케이션 ──
# 상장 당일은 pykrx/fdr 일봉에 '전일 종가'가 없어 등락률이 NaN이라 기준가를 알 수 없다.
# 38.co.kr 신규상장 표(각 행에 종목코드 포함)에서 공모가·상장일을 받아 상장일 기준가로 사용한다.
# 컬럼: 기업명 | 신규상장일 | 현재가 | 전일비 | 공모가 | 공모가대비등락 | 시초가 | 시초/공모 | 첫날종가
_ipo_cache = {}      # code -> (상장일 'YYYY-MM-DD', 공모가 int)
_ipo_page = 0
_ipo_done = False    # 마지막 페이지 도달

def _ipo_load_next():
    global _ipo_page, _ipo_done
    _ipo_page += 1
    url = f"http://www.38.co.kr/html/fund/index.htm?o=nw&page={_ipo_page}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=20).read().decode("euc-kr", "replace")
    tbs = [t for t in re.findall(r'<table[^>]*>.*?</table>', html, re.S) if "공모가" in t and "신규상장일" in t]
    added = 0
    if tbs:
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', tbs[0], re.S):
            m = re.search(r'code=([A-Za-z0-9]{6})', row)
            cells = [re.sub(r'<[^>]+>', ' ', c).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
            if not m or len(cells) < 5:
                continue
            listdate = cells[1].replace("/", "-").strip()      # 신규상장일
            g = re.sub(r'[^\d]', '', cells[4])                 # 공모가(원)
            if re.match(r'\d{4}-\d{2}-\d{2}$', listdate) and g:
                _ipo_cache[m.group(1)] = (listdate, int(g))
                added += 1
    if added == 0:
        _ipo_done = True
    return added

def ipo_base_price(code, listing_date, maxpage=60):
    """첫 봉 날짜(listing_date)가 38의 신규상장일과 일치하면 그 종목 공모가(기준가) 반환, 아니면 None.
    네트워크 오류는 예외를 그대로 올려보냄(호출부에서 재시도 처리)."""
    while code not in _ipo_cache and not _ipo_done and _ipo_page < maxpage:
        _ipo_load_next()
    rec = _ipo_cache.get(code)
    return rec[1] if rec and rec[0] == listing_date else None

# 1. 매매일지 고유 종목·날짜
trades = sb_get("trades?select=stock,date&deleted_at=is.null&order=date.desc")
seen = {}
for t in trades:
    if t.get("stock") and t.get("date"):
        seen[(t["stock"], t["date"])] = True
pairs = list(seen.keys())
print(f"매매일지 고유 종목·날짜 {len(pairs)}건", file=sys.stderr)

# 안전장치: 오늘 날짜 매매는 장 마감(18:30) 후에만 수집(장중엔 일봉 미확정 → 잘못 저장 방지)
today = dt.date.today().isoformat()
now = dt.datetime.now()
if (now.hour * 60 + now.minute) < 18 * 60 + 30:
    n_today = sum(1 for p in pairs if p[1] == today)
    if n_today:
        pairs = [p for p in pairs if p[1] != today]
        print(f"당일({today}) 매매 {n_today}건은 장 마감 후 수집(현재 미확정) → 이번엔 스킵", file=sys.stderr)

# 2. 이미 수집된 것 제외 (upload & not all) → 신규만
if MODE == "upload" and not FORCE_ALL:
    existing = set()
    try:
        for r in sb_get("market_data?select=stock,date"):
            existing.add((r["stock"], r["date"]))
    except Exception as e:
        print("기존 조회 실패(전체 수집으로 진행):", str(e)[:60], file=sys.stderr)
    pairs = [p for p in pairs if p not in existing]
    print(f"신규(미수집) {len(pairs)}건", file=sys.stderr)

if not pairs:
    print("수집할 신규 건 없음. 종료.", file=sys.stderr)
    sys.exit(0)

# 3. 종목명→코드 맵 + 지수
print("종목 리스트 로딩...", file=sys.stderr)
name2code = {}
for market in ["KRX", "ETF/KR"]:
    try:
        lst = fdr.StockListing(market)
        namecol = "Name" if "Name" in lst.columns else lst.columns[1]
        codecol = "Code" if "Code" in lst.columns else "Symbol"
        for n, c in zip(lst[namecol], lst[codecol]):
            if n and c and str(n).strip() not in name2code:
                name2code[str(n).strip()] = str(c)
    except Exception as e:
        print(f"  {market} 실패: {str(e)[:60]}", file=sys.stderr)
print(f"종목 {len(name2code)}개", file=sys.stderr)

idx_cache = {}
def index_for(date):
    if date in idx_cache: return idx_cache[date]
    d = dt.date.fromisoformat(date)
    out = {}
    for key, sym in [("kospi", "KS11"), ("kosdaq", "KQ11")]:
        try:
            df = fdr.DataReader(sym, (d - dt.timedelta(days=8)).isoformat(), date)
            if len(df) >= 2:
                c = df["Close"].tolist()
                out[key] = round((c[-1] - c[-2]) / c[-2] * 100, 2)
        except Exception:
            pass
    idx_cache[date] = out
    return out

def analyze(stock, date):
    code = name2code.get(stock.split(",")[0].strip())
    if not code: return "NOCODE"  # 상폐/명칭변경 등 영구 실패 → 마커 저장해 매일 재시도 방지
    d = dt.date.fromisoformat(date)
    try:
        df = fdr.DataReader(code, (d - dt.timedelta(days=60)).isoformat(), date)  # 연속 상한가 소급 위해 넉넉히
    except Exception:
        return None  # 네트워크/일시 오류 → 저장 안 하고 다음 실행에 재시도
    if df.empty: return "NOCODE"  # 코드는 있으나 데이터 없음(상폐 등) → 영구 마커
    O, H, L, C, D = df["Open"].tolist(), df["High"].tolist(), df["Low"].tolist(), df["Close"].tolist(), [str(x.date()) for x in df.index]
    V = df["Volume"].tolist() if "Volume" in df.columns else [1]*len(df)
    N = len(df)
    # 상장 당일 감지: 첫 봉이 조회창 시작보다 한참 뒤면(=그 앞에 데이터 없음) 상장 구간 →
    # 그때만 38에서 공모가를 조회(대부분의 일반 종목은 조회 스킵). 첫 봉이 실제 상장일이면
    # 전일종가가 없으므로 공모가를 기준가로 써서 등락률/갭을 계산한다.
    base0 = None
    if (dt.date.fromisoformat(D[0]) - (d - dt.timedelta(days=60))).days > 7:
        try:
            base0 = ipo_base_price(code, D[0])   # 38 신규상장일 == 첫 봉 날짜일 때만 공모가 반환
        except Exception:
            return None                          # 38 일시 오류 → 저장 안 함(다음 실행 재시도)
    if N < 2 and not base0:
        return "NOCODE"                      # 데이터 1행뿐 + 기준가 없음(상폐/특수) → 영구 마커
    rate_at = [None]*N
    if base0:
        rate_at[0] = round((C[0]-base0)/base0*100, 2)   # 상장일 종가 등락률 = 공모가(기준가) 대비
    for i in range(1, N):
        rate_at[i] = round((C[i]-C[i-1])/C[i-1]*100, 2) if C[i-1] else None
    # 상장일 봉(i==0)은 가격제한폭이 ±30%가 아니라 공모가의 60~400%라 '상한가' 판정에서 제외
    upper_at = [(i > 0 and rate_at[i] is not None and rate_at[i] >= 29.0) for i in range(N)]
    halt_at = [(V[i] == 0) for i in range(N)]  # 거래정지(거래량 0)

    # 연속 상한가/상승 회차: 전일(N-2)부터 거꾸로. 4일 제한 없음. 거래정지일은 예외로 건너뜀(스트릭 유지)
    def streak(cond):
        s = 0; halts = 0; j = N-2
        while j >= 1:
            if halt_at[j]: halts += 1; j -= 1; continue
            if cond(j): s += 1; j -= 1
            else: break
        return s, halts
    upper_streak, upper_halts = streak(lambda j: upper_at[j])
    up_streak, _ = streak(lambda j: rate_at[j] is not None and rate_at[j] > 0)

    # bars = 최근 4거래일 (OHLC + 봉형태)
    bars = []
    for i in range(max(0, N-4), N):
        prev = C[i-1] if i > 0 else base0   # 상장일 첫 봉은 공모가를 전일종가 대용으로
        gap = round((O[i]-prev)/prev*100, 2) if prev else None
        hrate = round((H[i]-prev)/prev*100, 2) if prev else None
        rng = H[i] - L[i]
        pct = lambda x: round(x / rng * 100) if rng > 0 else 0
        cndl = "양봉" if C[i] > O[i] else ("음봉" if C[i] < O[i] else "도지")
        bar = {"date": D[i], "o": O[i], "h": H[i], "l": L[i], "c": C[i],
               "rate": rate_at[i], "gap": gap, "hrate": hrate, "upper": upper_at[i],
               "cndl": cndl, "body": pct(abs(C[i]-O[i])), "upw": pct(H[i]-max(O[i], C[i])), "loww": pct(min(O[i], C[i])-L[i])}
        if base0 and D[i] == D[0]:   # 상장 당일 봉: 등락/갭/고점률이 모두 공모가(기준가) 대비임을 표시
            bar["listing"] = True; bar["base"] = base0
        bars.append(bar)
    idx = index_for(date)
    sgn = lambda v: (f"+{v}" if v >= 0 else f"{v}") if v is not None else "-"
    tb = bars[-1]; pb = bars[-2] if len(bars) >= 2 else None
    parts = []
    if pb:
        if pb["upper"]: parts.append(f"전일({pb['date'][5:]}) 상한가 마감(+{pb['rate']}%)")
        else: parts.append(f"전일({pb['date'][5:]}) {pb['cndl']} 종가 등락 {sgn(pb['rate'])}%" + (f", 장중 고점 {sgn(pb['hrate'])}%" if pb['hrate'] and pb['hrate'] >= 20 else ""))
    if upper_streak > 0:
        parts.append(f"전일까지 {upper_streak}일 연속 상한가" + (f"(중간 거래정지 {upper_halts}일 제외)" if upper_halts else ""))
    elif up_streak > 0:
        parts.append(f"전일까지 {up_streak}일 연속 상승")
    gapstr = f"갭{'상승' if (tb['gap'] or 0) > 1 else '하락' if (tb['gap'] or 0) < -1 else '보합'}({tb['gap']}%)" if tb['gap'] is not None else ""
    if tb.get("listing"):   # 신규상장 당일: 모든 등락률이 전일종가가 아닌 공모가(기준가) 대비임을 명시
        parts.append(f"당일({tb['date'][5:]}) 신규상장 첫날 — 공모가 {tb['base']:,}원 기준(전일종가 없음, 이하 % 모두 공모가 대비): 시초 {sgn(tb['gap'])}% 출발 {tb['cndl']}(몸통{tb['body']}%·윗꼬리{tb['upw']}%·아랫꼬리{tb['loww']}%), 종가 {sgn(tb['rate'])}%, 장중 고점 {sgn(tb['hrate'])}%")
    else:
        parts.append(f"당일({tb['date'][5:]}) {gapstr} 출발 {tb['cndl']}(몸통{tb['body']}%·윗꼬리{tb['upw']}%·아랫꼬리{tb['loww']}%), 종가 등락 {sgn(tb['rate'])}%, 장중 고점 {sgn(tb['hrate'])}%" + ("[상한가마감]" if tb['upper'] else ""))
    if idx:
        mk = []
        if "kospi" in idx: mk.append(f"코스피 {idx['kospi']}%")
        if "kosdaq" in idx: mk.append(f"코스닥 {idx['kosdaq']}%")
        tone = "하락장" if (idx.get("kosdaq", 0) < -1 or idx.get("kospi", 0) < -1) else ("상승장" if (idx.get("kosdaq", 0) > 1 or idx.get("kospi", 0) > 1) else "보합장")
        parts.append(f"지수: {', '.join(mk)} ({tone})")
    return {"code": code, "bars": bars, "index": idx, "summary": " / ".join(parts)}

# 4. 수집
results, ok, nocode, retry = [], 0, 0, 0
for i, (stock, date) in enumerate(pairs):
    r = analyze(stock, date)
    if r == "NOCODE":
        nocode += 1
        results.append({"stock": stock, "date": date, "code": None, "data": {"skip": True}})  # 영구실패 마커
    elif r:
        ok += 1
        results.append({"stock": stock, "date": date, "code": r["code"], "data": {"bars": r["bars"], "index": r["index"], "summary": r["summary"]}})
    else:
        retry += 1  # 일시 실패 → 저장 안 함(다음 실행 재시도)
    if (i+1) % 50 == 0: print(f"  {i+1}/{len(pairs)} (성공 {ok}, 영구실패 {nocode}, 재시도대상 {retry})", file=sys.stderr)
print(f"수집: 성공 {ok} / 영구실패(마커) {nocode} / 재시도대상 {retry} / 대상 {len(pairs)}", file=sys.stderr)

# 5. 업로드 또는 검증 출력
if MODE == "upload":
    for i in range(0, len(results), 100):
        sb_upsert(results[i:i+100])
    print(f"업로드 완료: {len(results)}건", file=sys.stderr)
else:
    json.dump(results, open(os.path.join(BASE, "market_out.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # 상장일 등 특수 케이스가 잘 잡혔는지 우선 확인: 상장봉 포함 결과부터, 없으면 앞에서 10건
    listing = [r for r in results if any(b.get("listing") for b in r["data"].get("bars", []))]
    for r in (listing[:10] or results[:10]):
        print(f"[{r['stock']} {r['date']}] {r['data'].get('summary', '(수집 제외 마커)')}")
