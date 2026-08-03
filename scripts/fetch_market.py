# 매매일지 종목·날짜별 시장 데이터(OHLCV·상한가·갭·등락률 + 지수) 수집
# FinanceDataReader 사용 (pykrx보다 안정적). 결과: market_out.json (검증) / --upload 시 Supabase upsert
import json, datetime as dt, sys, urllib.request
import FinanceDataReader as fdr

SB_URL = "https://vbdtrynddjryxcpgpisf.supabase.co"
SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiZHRyeW5kZGpyeXhjcGdwaXNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDI0MDEsImV4cCI6MjA5NTk3ODQwMX0.p3Bs8i-sNz6GodYIXLg1BzdrTxAc9-jB2dZRaOKCW3M"
HDR = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Content-Type": "application/json"}

def sb_get(path):
    req = urllib.request.Request(f"{SB_URL}/rest/v1/{path}", headers=HDR)
    return json.load(urllib.request.urlopen(req))

def sb_upsert(rows):
    h = {**HDR, "Prefer": "resolution=merge-duplicates,return=minimal"}
    req = urllib.request.Request(f"{SB_URL}/rest/v1/market_data", data=json.dumps(rows).encode(), headers=h, method="POST")
    urllib.request.urlopen(req)

print("종목 리스트 로딩...", file=sys.stderr)
name2code = {}
for market in ["KRX", "ETF/KR"]:
    try:
        lst = fdr.StockListing(market)
        namecol = "Name" if "Name" in lst.columns else lst.columns[1]
        codecol = "Code" if "Code" in lst.columns else "Symbol"
        for n, c in zip(lst[namecol], lst[codecol]):
            if n and c and n not in name2code:
                name2code[str(n).strip()] = str(c)
    except Exception as e:
        print(f"  {market} 실패: {e}", file=sys.stderr)
print(f"종목 {len(name2code)}개", file=sys.stderr)

# 지수 캐시 (날짜별 코스피/코스닥 등락률)
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
    first = stock.split(",")[0].strip()
    code = name2code.get(first)
    if not code: return None
    d = dt.date.fromisoformat(date)
    try:
        df = fdr.DataReader(code, (d - dt.timedelta(days=14)).isoformat(), date)
    except Exception:
        return None
    if df.empty or len(df) < 2: return None
    df = df.tail(4)
    o, h, l, c, idxs = df["Open"].tolist(), df["High"].tolist(), df["Low"].tolist(), df["Close"].tolist(), [str(x.date()) for x in df.index]
    bars = []
    for i in range(len(df)):
        prev = c[i-1] if i > 0 else None
        rate = round((c[i]-prev)/prev*100, 2) if prev else None
        gap = round((o[i]-prev)/prev*100, 2) if prev else None
        hrate = round((h[i]-prev)/prev*100, 2) if prev else None
        bars.append({"date": idxs[i], "o": o[i], "h": h[i], "l": l[i], "c": c[i],
                     "rate": rate, "gap": gap, "hrate": hrate,
                     "upper": bool(rate is not None and rate >= 29.0)})
    idx = index_for(date)
    # 요약 생성
    sgn = lambda v: (f"+{v}" if v >= 0 else f"{v}") if v is not None else "-"
    tb = bars[-1]  # 당일
    pb = bars[-2] if len(bars) >= 2 else None
    parts = []
    if pb:
        if pb["upper"]: parts.append(f"전일({pb['date'][5:]}) 상한가 마감(+{pb['rate']}%)")
        else: parts.append(f"전일({pb['date'][5:]}) 종가 등락 {sgn(pb['rate'])}%" + (f", 장중 고점 {sgn(pb['hrate'])}%" if pb['hrate'] and pb['hrate']>=20 else ""))
    gapstr = f"갭{'상승' if (tb['gap'] or 0)>1 else '하락' if (tb['gap'] or 0)<-1 else '보합'}({tb['gap']}%)" if tb['gap'] is not None else ""
    parts.append(f"당일({tb['date'][5:]}) {gapstr} 출발, 종가 등락 {sgn(tb['rate'])}%, 장중 고점 {sgn(tb['hrate'])}%" + ("[상한가마감]" if tb['upper'] else ""))
    if idx:
        mk = []
        if "kospi" in idx: mk.append(f"코스피 {idx['kospi']}%")
        if "kosdaq" in idx: mk.append(f"코스닥 {idx['kosdaq']}%")
        market_tone = "하락장" if (idx.get("kosdaq", 0) < -1 or idx.get("kospi", 0) < -1) else ("상승장" if (idx.get("kosdaq",0)>1 or idx.get("kospi",0)>1) else "보합장")
        parts.append(f"지수: {', '.join(mk)} ({market_tone})")
    return {"code": code, "bars": bars, "index": idx, "summary": " / ".join(parts)}

MODE = sys.argv[1] if len(sys.argv) > 1 else "test"
print("매매일지 로딩...", file=sys.stderr)
trades = sb_get("trades?select=stock,date&deleted_at=is.null&order=date.desc")
# 중복 제거 (stock+date)
seen = {}
for t in trades:
    if t.get("stock") and t.get("date"):
        seen[(t["stock"], t["date"])] = True
pairs = list(seen.keys())
print(f"고유 종목·날짜 {len(pairs)}건", file=sys.stderr)

results, ok, fail = [], 0, 0
for i, (stock, date) in enumerate(pairs):
    r = analyze(stock, date)
    if r:
        ok += 1
        results.append({"stock": stock, "date": date, "code": r["code"], "data": {"bars": r["bars"], "index": r["index"], "summary": r["summary"]}})
    else:
        fail += 1
    if (i+1) % 50 == 0: print(f"  {i+1}/{len(pairs)} (성공 {ok}, 실패 {fail})", file=sys.stderr)

json.dump(results, open(".pykrx_tmp/market_out.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"\n완료: 성공 {ok} / 실패 {fail} / 전체 {len(pairs)}", file=sys.stderr)

if MODE == "upload":
    print("Supabase 업로드...", file=sys.stderr)
    for i in range(0, len(results), 100):
        sb_upsert(results[i:i+100])
    print(f"업로드 완료: {len(results)}건", file=sys.stderr)
else:
    # 샘플 10건 요약 출력
    for r in results[:10]:
        print(f"[{r['stock']} {r['date']}] {r['data']['summary']}")
