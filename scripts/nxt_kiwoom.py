# NXT(넥스트레이드) 시세 보정 — 키움 REST API
# KRX 일봉(정규장 09:00~15:30)은 전일 애프터마켓(15:30~20:00)·당일 프리마켓(08:00~08:50) 움직임을 모른다.
# 그래서 'KRX 갭'이 실제 직전 가격 대비 흐름과 크게 어긋날 수 있어, NXT 분봉으로 실질 갭·세션별 흐름을 보정한다.
#
# 키움 REST API(공식: github.com/Kiwoom-Securities/Kiwoom-REST-API)
#   토큰  POST /oauth2/token {grant_type:client_credentials, appkey, secretkey} → token (발급 IP에서만 사용 가능)
#   분봉  POST /api/dostk/chart  api-id: ka10080  {stk_cd:"039490_NX", tic_scope:"1", upd_stkpc_tp:"1", base_dt:"YYYYMMDD"}
#         → stk_min_pole_chart_qry[{cntr_tm:YYYYMMDDHHmmss, open_pric, high_pric, low_pric, cur_prc, trde_qty}] (가격에 부호 포함)
#   일봉  api-id: ka10081  {stk_cd:"039490_NX", base_dt, upd_stkpc_tp} → stk_dt_pole_chart_qry[{dt, open_pric, high_pric, low_pric, cur_prc}]
#   연속조회: 응답 헤더 cont-yn=Y, next-key → 다음 요청 헤더에 그대로
# 키: 환경변수 KIWOOM_APPKEY / KIWOOM_SECRETKEY (GitHub Secret, 로컬은 프로젝트 루트 .env) — 없으면 보정 생략
import json, os, re, time, urllib.request, urllib.error

BASE_URL = "https://api.kiwoom.com"
NXT_START = "2025-03-04"   # 넥스트레이드 개장일(이전 날짜는 NXT 없음)
_token = None


def _env(k):
    v = os.environ.get(k, "").strip()
    if v:
        return v
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    if os.path.exists(env):
        for line in open(env, encoding="utf-8"):
            m = re.match(rf"\s*{k}\s*=\s*[\"']?([^\"'\r\n]+)", line)
            if m:
                return m.group(1).strip()
    return ""


def enabled():
    return bool(_env("KIWOOM_APPKEY") and _env("KIWOOM_SECRETKEY"))


last_error = ""   # 마지막 실패 사유(키움 return_code/return_msg 또는 HTTP 오류) — 진단 출력용


def _post(path, body, headers):
    global last_error
    req = urllib.request.Request(BASE_URL + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json;charset=UTF-8", **headers})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r), r.headers
    except urllib.error.HTTPError as e:   # 키움은 오류도 JSON(return_code/return_msg)으로 줌 → 사유를 남김
        text = e.read().decode("utf-8", "replace")
        try:
            d = json.loads(text)
            last_error = f"HTTP {e.code} · {d.get('return_code')} {d.get('return_msg')}"
        except Exception:
            last_error = f"HTTP {e.code} {e.reason} · 응답: {' '.join(text.split())[:300] or '(빈 응답)'}"
        raise
    except urllib.error.URLError as e:
        last_error = f"연결 오류: {e.reason}"
        raise


def _get_token():
    global _token
    if not _token:
        d, _ = _post("/oauth2/token", {"grant_type": "client_credentials", "appkey": _env("KIWOOM_APPKEY"), "secretkey": _env("KIWOOM_SECRETKEY")}, {})
        if not d.get("token"):
            global last_error
            last_error = f"토큰 발급 실패: {d.get('return_code')} {d.get('return_msg')}"
            raise RuntimeError(last_error)
        _token = d["token"]
    return _token


def _chart(api_id, body, list_key, stop):
    """연속조회하며 행을 모음. stop(row)이 True면 중단(최신→과거 순으로 내려오므로 기준일 이전이 나오면 끝)"""
    rows, cont, nkey = [], None, None
    for _ in range(6):
        h = {"api-id": api_id, "authorization": f"Bearer {_get_token()}"}
        if cont == "Y" and nkey:
            h["cont-yn"], h["next-key"] = "Y", nkey
        d, rh = _post("/api/dostk/chart", body, h)
        time.sleep(0.25)   # TR 호출 한도(초당 수 회) 여유
        if str(d.get("return_code", "0")) not in ("0", ""):
            raise LookupError(f"{d.get('return_code')} {d.get('return_msg')}")
        part = d.get(list_key) or []
        rows += part
        if not part or any(stop(r) for r in part):
            break
        cont, nkey = rh.get("cont-yn"), rh.get("next-key")
        if cont != "Y":
            break
    return rows


_num = lambda v: abs(int(float(str(v).replace(",", "").replace("+", "") or 0)))


def _minutes(code, ymd):
    """해당 날짜의 NXT 1분봉 [(HHMM, o,h,l,c,vol)] 시간순"""
    rows = _chart("ka10080", {"stk_cd": f"{code}_NX", "tic_scope": "1", "upd_stkpc_tp": "1", "base_dt": ymd},
                  "stk_min_pole_chart_qry", lambda r: str(r.get("cntr_tm", ""))[:8] < ymd)
    out = []
    for r in rows:
        t = str(r.get("cntr_tm", ""))
        if t[:8] == ymd:
            out.append((t[8:12], _num(r.get("open_pric")), _num(r.get("high_pric")), _num(r.get("low_pric")), _num(r.get("cur_prc")), _num(r.get("trde_qty"))))
    return sorted(out)


def _daily(code, ymd):
    rows = _chart("ka10081", {"stk_cd": f"{code}_NX", "base_dt": ymd, "upd_stkpc_tp": "1"},
                  "stk_dt_pole_chart_qry", lambda r: True)   # 첫 페이지면 충분(기준일 포함 최근 일봉들)
    return {str(r.get("dt")): (_num(r.get("open_pric")), _num(r.get("high_pric")), _num(r.get("low_pric")), _num(r.get("cur_prc"))) for r in rows}


def _agg(bars):
    if not bars:
        return None
    return {"o": bars[0][1], "h": max(b[2] for b in bars), "l": min(b[3] for b in bars), "c": bars[-1][4], "v": sum(b[5] for b in bars)}


def compute(code, date, prev_date):
    """date(당일)·prev_date(전 거래일)의 NXT 세션 시세. NXT 미거래면 {"none": True}, 일시 오류면 None"""
    if not code or date < NXT_START:
        return {"none": True}
    d, p = date.replace("-", ""), prev_date.replace("-", "")
    try:
        today, prev = _minutes(code, d), (_minutes(code, p) if prev_date >= NXT_START else [])
        if today or prev:
            return {
                "src": "1분봉",
                "prev_after": _agg([b for b in prev if b[0] >= "1530"]),
                "prev_last": prev[-1][4] if prev else None,
                "pre": _agg([b for b in today if b[0] < "0900"]),
                "after": _agg([b for b in today if b[0] >= "1530"]),
            }
        # 분봉이 없는 과거 날짜 → NXT 일봉(세션 구분 없음)으로 대체
        dd = _daily(code, d)
        if d in dd or p in dd:
            t = dd.get(d)
            return {"src": "일봉", "prev_last": dd[p][3] if p in dd else None,
                    "day": ({"o": t[0], "h": t[1], "l": t[2], "c": t[3]} if t else None)}
        return {"none": True}
    except LookupError:
        return {"none": True}   # NXT 미상장·조회 불가 종목 → 재시도 불필요
    except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError):
        return None             # 네트워크·토큰 등 일시 오류 → 다음 실행에 재시도


def summary_line(nx, krx_prev_close, krx_open, krx_close, krx_gap):
    """분석 프롬프트에 들어갈 보정 문장(KRX 수치 옆에 '실질' 수치를 명시)"""
    if not nx or nx.get("none"):
        return ""
    pct = lambda a, b: f"{(a - b) / b * 100:+.2f}%" if a and b else "-"
    won = lambda v: f"{v:,}" if v else "-"
    parts = []
    last = nx.get("prev_last")
    if last:
        pa = nx.get("prev_after")
        parts.append(f"전일 NXT 마지막가 {won(last)}(KRX 종가 대비 {pct(last, krx_prev_close)}"
                     + (f", 애프터 15:30~20:00 고{won(pa['h'])}·저{won(pa['l'])}" if pa else "") + ")")
    pre = nx.get("pre")
    if pre:
        parts.append(f"당일 프리마켓 08:00~08:50 시{won(pre['o'])}·고{won(pre['h'])}·저{won(pre['l'])}·종{won(pre['c'])}")
    ref = (pre or {}).get("c") or last
    if ref and krx_open:
        parts.append(f"KRX 시가 {won(krx_open)} = 실질 갭 {pct(krx_open, ref)}(NXT 직전가 대비; 위 KRX 갭 {krx_gap}%는 NXT 미반영)")
    af = nx.get("after")
    if af:
        parts.append(f"당일 애프터 고{won(af['h'])}·저{won(af['l'])}·종{won(af['c'])}(KRX 종가 대비 {pct(af['c'], krx_close)})")
    day = nx.get("day")
    if day and not pre and not af:
        parts.append(f"당일 NXT 전체(세션 구분 없음) 시{won(day['o'])}·고{won(day['h'])}·저{won(day['l'])}·종{won(day['c'])}")
    return ("[NXT 보정·" + nx.get("src", "") + "] " + " → ".join(parts)) if parts else ""


# 연결 점검: python scripts/nxt_kiwoom.py  → 토큰 발급과 NXT 분봉 1회 조회 결과(사유 포함) 출력
if __name__ == "__main__":
    import datetime as _dt
    print("키 설정:", "있음" if enabled() else "없음(.env의 KIWOOM_APPKEY/KIWOOM_SECRETKEY)")
    for k in ("KIWOOM_APPKEY", "KIWOOM_SECRETKEY"):   # 값은 숨기고 형식만 점검(붙여넣기 실수 확인)
        v = _env(k)
        bad = [n for n, f in (("공백", any(c.isspace() for c in v)), ("따옴표", any(c in "\"'<>" for c in v)),
                              ("비영문자", any(ord(c) > 127 for c in v))) if f]
        print(f"  {k}: {len(v)}자, 앞뒤 {v[:2]}…{v[-2:] if v else ''}" + (f"  ⚠️ {'/'.join(bad)} 포함" if bad else "  (형식 이상 없음)"))
    try:
        print("공인 IP:", urllib.request.urlopen("https://ifconfig.me", timeout=5).read().decode())
    except Exception:
        pass
    try:
        _get_token(); print("토큰 발급: 성공")
    except Exception as e:
        print("토큰 발급: 실패 →", last_error or e); raise SystemExit(1)
    day = _dt.date.today()
    while day.weekday() >= 5: day -= _dt.timedelta(days=1)
    for code in ("005930",):
        try:
            rows = _minutes(code, day.strftime("%Y%m%d"))
            print(f"NXT 1분봉 {code}_NX {day}: {len(rows)}개", rows[:1], rows[-1:] if rows else "")
        except Exception as e:
            print(f"NXT 1분봉 조회 실패 → {last_error or e}")
