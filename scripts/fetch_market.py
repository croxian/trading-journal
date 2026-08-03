# 매매일지 종목·날짜별 시장 데이터(OHLCV·상한가·갭·등락률 + 지수) 수집
# FinanceDataReader 사용 (pykrx보다 안정적). Supabase market_data 테이블에 저장.
#   python fetch_market.py test        # 검증(로컬 출력만, 업로드 안 함)
#   python fetch_market.py upload       # 신규(미수집) 종목·날짜만 수집 -> 업로드  ← 매일 자동 실행용
#   python fetch_market.py upload all   # 전체 재수집(강제)
import json, datetime as dt, sys, os, urllib.request
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
        df = fdr.DataReader(code, (d - dt.timedelta(days=14)).isoformat(), date)
    except Exception:
        return None  # 네트워크/일시 오류 → 저장 안 하고 다음 실행에 재시도
    if df.empty or len(df) < 2: return "NOCODE"  # 코드는 있으나 데이터 없음(상폐 등) → 영구 마커
    df = df.tail(4)
    o, h, l, c, dd = df["Open"].tolist(), df["High"].tolist(), df["Low"].tolist(), df["Close"].tolist(), [str(x.date()) for x in df.index]
    bars = []
    for i in range(len(df)):
        prev = c[i-1] if i > 0 else None
        rate = round((c[i]-prev)/prev*100, 2) if prev else None
        gap = round((o[i]-prev)/prev*100, 2) if prev else None
        hrate = round((h[i]-prev)/prev*100, 2) if prev else None
        bars.append({"date": dd[i], "o": o[i], "h": h[i], "l": l[i], "c": c[i],
                     "rate": rate, "gap": gap, "hrate": hrate,
                     "upper": bool(rate is not None and rate >= 29.0)})
    idx = index_for(date)
    sgn = lambda v: (f"+{v}" if v >= 0 else f"{v}") if v is not None else "-"
    tb = bars[-1]; pb = bars[-2] if len(bars) >= 2 else None
    parts = []
    if pb:
        if pb["upper"]: parts.append(f"전일({pb['date'][5:]}) 상한가 마감(+{pb['rate']}%)")
        else: parts.append(f"전일({pb['date'][5:]}) 종가 등락 {sgn(pb['rate'])}%" + (f", 장중 고점 {sgn(pb['hrate'])}%" if pb['hrate'] and pb['hrate'] >= 20 else ""))
    gapstr = f"갭{'상승' if (tb['gap'] or 0) > 1 else '하락' if (tb['gap'] or 0) < -1 else '보합'}({tb['gap']}%)" if tb['gap'] is not None else ""
    parts.append(f"당일({tb['date'][5:]}) {gapstr} 출발, 종가 등락 {sgn(tb['rate'])}%, 장중 고점 {sgn(tb['hrate'])}%" + ("[상한가마감]" if tb['upper'] else ""))
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
    for r in results[:10]:
        print(f"[{r['stock']} {r['date']}] {r['data']['summary']}")
