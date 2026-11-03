// 기존 세트(같은 날·같은 종목 2건 이상) 일괄 세트 분석 — 앱과 같은 프롬프트(src/setAnalysis.js) 사용
// 사용: node scripts/backfill_sets.mjs [--limit N] [--only "YYYY-MM-DD|종목"] [--progress 파일경로]
// - 순차 실행(고정 블록 프롬프트 캐시 적중) / 진행 파일에 완료 키 기록 → 중단 후 재실행하면 이어서 처리
// - trade_sets 테이블이 없으면 중단(scripts/trade_sets.sql 먼저 실행)
import fs from "node:fs";
import { SET_SYSTEM, buildStaticText, buildSetVariableText, parseSetResult } from "../src/setAnalysis.js";

const APP = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const SB_URL = APP.match(/const SB_URL = "([^"]+)"/)[1];
const SB_KEY = APP.match(/const SB_KEY = "([^"]+)"/)[1];
const ENV = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const API_KEY = ENV.match(/^\s*VITE_ANTHROPIC_KEY\s*=\s*["']?([^"'\r\n]+)/m)[1].trim();
const MODEL = APP.match(/const AI_MODEL = "([^"]+)"/)[1];
const EFFORT = APP.match(/const AI_EFFORT = "([^"]+)"/)[1];
const FALLBACK = "claude-fable-5-1";
const MAX_TOKENS = 48000;   // 세트 분석은 추론+기록별 6항목이 길어 24000에서 끝(DATA)이 잘린 사례 있음
const HDR = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") || "0") || Infinity;
const ONLY = arg("--only");
const SINCE = arg("--since");   // 예: 2026-02-01 (그 이전 세트 제외)
const PROGRESS = arg("--progress") || "backfill_sets_progress.json";

const sb = async (q, opt = {}) => {
  const r = await fetch(`${SB_URL}/rest/v1/${q}`, { ...opt, headers: { ...HDR, ...(opt.headers || {}) } });   // 인증 헤더가 opt.headers에 덮이지 않게 마지막에
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 || opt.method === "PATCH" || opt.method === "POST" ? null : r.json();
};

// ---- 앱과 동일한 변환/헬퍼
const rowToTech = (r) => ({ id: r.id, name: r.name, category: r.category, timeframe: r.timeframe, entry: r.entry, exit: r.exit, pattern: r.pattern, tags: r.tags, rawInput: r.raw_input });
const rowToTrade = (r) => ({ id: r.id, stock: r.stock, date: r.date, buyPrice: r.buy_price, sellPrice: r.sell_price, amount: r.amount, pnl: r.pnl, pnlRate: r.pnl_rate, reason: r.reason, technique: r.technique, memo: r.memo, aiAnalysis: r.ai_analysis });
const rowToLive = (r) => ({ id: r.id, title: r.title, stock: r.stock, date: r.date, textContent: r.text_content, category: r.category });
const matchStock = (a, b) => {
  if (!a || !b) return false;
  const n = s => s.replace(/\s+/g, "").replace(/^\*/, "").toLowerCase();
  const isPref = s => /우[A-Z]?$/.test(s.replace(/\s+/g, ""));
  if (isPref(a) || isPref(b)) return n(a) === n(b);
  return n(a) === n(b) || n(a).includes(n(b)) || n(b).includes(n(a));
};
const stockList = (s) => (s || "").split(",").map(x => x.trim()).filter(Boolean);
const imgStock = (im, stocks) => im.s || (stocks.length === 1 ? stocks[0] : "");
const isObserveTrade = (t) => !String(t?.buyPrice ?? "").trim() && !String(t?.sellPrice ?? "").trim();
const TIMING_SUFFIXES = ["시초", "종배", "종가"];
const techGroupOf = (tech) => { if (!tech) return "미분류"; const i = tech.lastIndexOf("-"); if (i === -1) return tech; return TIMING_SUFFIXES.includes(tech.slice(i + 1)) ? tech.slice(0, i) : tech; };
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const withLec = (text, id) => (id ? `${text}\n<!--LEC:${id}-->` : text);

const claude = async (content) => {
  // 스트리밍(SSE): 추론+본문이 길어 응답이 5분을 넘을 수 있어, 비스트리밍 대기 타임아웃을 피함
  const post = async (model, eff) => {
    for (let a = 0; a < 4; a++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": API_KEY },
        body: JSON.stringify({ model, max_tokens: MAX_TOKENS, stream: true, system: SET_SYSTEM, messages: [{ role: "user", content }], ...(eff ? { output_config: { effort: eff } } : {}) }),
      });
      if (r.ok) {
        let text = "", stop = null, usage = {}, buf = "";
        const dec = new TextDecoder();
        for await (const chunk of r.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const ev = buf.slice(0, i); buf = buf.slice(i + 2);
            const line = ev.split("\n").find(l => l.startsWith("data: "));
            if (!line) continue;
            const d = JSON.parse(line.slice(6));
            if (d.type === "message_start") usage = { ...d.message.usage };
            else if (d.type === "content_block_delta" && d.delta?.type === "text_delta") text += d.delta.text;
            else if (d.type === "message_delta") { stop = d.delta?.stop_reason ?? stop; usage = { ...usage, ...d.usage }; }
            else if (d.type === "error") throw new Error(`stream error ${JSON.stringify(d.error).slice(0, 200)}`);
          }
        }
        return { text, stop, usage, model };
      }
      if ([429, 500, 529].includes(r.status) && a < 3) { await new Promise(s => setTimeout(s, 15000 * (a + 1))); continue; }
      throw new Error(`API ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  };
  let r = await post(MODEL, EFFORT);
  if (!r.text.trim()) r = await post(FALLBACK);   // 거부/빈 응답 → 대체 모델
  if (!r.text.trim()) throw new Error(`빈 응답(${r.stop})`);
  return r;
};
// Opus 5.5 단가($/1M): 입력 4, 캐시쓰기(5분) 5, 캐시읽기 0.2, 출력 20
const costOf = (u) => ((u.input_tokens || 0) * 4 + (u.cache_creation_input_tokens || 0) * 5 + (u.cache_read_input_tokens || 0) * 0.2 + (u.output_tokens || 0) * 20) / 1e6;

// --dry: 저장·과금 없이 첫 세트의 입력 토큰만 count_tokens로 확인(고정 블록/가변 부분 크기)
const DRY = process.argv.includes("--dry");
const countTokens = async (content) => {
  const r = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": API_KEY },
    body: JSON.stringify({ model: MODEL, system: SET_SYSTEM, messages: [{ role: "user", content }] }),
  });
  return (await r.json()).input_tokens;
};

// ---- 데이터 로드
if (!DRY) {
  try { await sb("trade_sets?select=key&limit=1"); }
  catch { console.error("❌ trade_sets 테이블이 없습니다. scripts/trade_sets.sql을 Supabase SQL Editor에서 먼저 실행하세요."); process.exit(1); }
}
const techniques = (await sb("techniques?select=*&order=id.asc")).map(rowToTech);
const trades = (await sb("trades?select=id,stock,date,buy_price,sell_price,amount,pnl,pnl_rate,reason,technique,memo,ai_analysis&deleted_at=is.null&order=id.asc")).map(rowToTrade)
  .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);   // 앱 목록 순서
const lives = (await sb("live_trades?select=id,title,stock,date,text_content,category&deleted_at=is.null&order=id.desc")).map(rowToLive);
const lectureLives = lives.filter(t => t.category === "강의");
const corrs = await sb("analysis_corrections?select=*&order=created_at.desc&limit=10").catch(() => []);
const STATIC = buildStaticText({ techniques, lectureLives });

// 세트 구성(2건 이상)
const sets = [], seen = new Set();
for (const t of [...trades].sort((a, b) => a.id - b.id)) {
  if (seen.has(t.id)) continue;
  const ms = trades.filter(x => x.date === t.date && matchStock(x.stock, t.stock)).sort((a, b) => a.id - b.id);
  ms.forEach(m => seen.add(m.id));
  if (ms.length > 1) sets.push(ms);
}
const keyOf = (ms) => `${ms[0].date}|${ms[0].stock}`;
const progress = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, "utf8")) : { done: {}, cost: 0 };
const todo = sets.filter(ms => (!ONLY || keyOf(ms) === ONLY) && (!SINCE || ms[0].date >= SINCE) && !progress.done[keyOf(ms)]).slice(0, LIMIT);
console.log(`세트 ${sets.length}개 중 처리 대상 ${todo.length}개 (완료 ${Object.keys(progress.done).length}) · 모델 ${MODEL}@${EFFORT}`);

for (const [si, members] of todo.entries()) {
  const key = keyOf(members), base = members[0];
  const t0 = Date.now();
  try {
    const labels = members.map((_, i) => `T${i + 1}`);
    const labelOf = Object.fromEntries(members.map((t, i) => [t.id, labels[i]]));
    const charts = [];
    for (const t of members) {
      const img = (await sb(`trades?select=chart_img&id=eq.${t.id}`))[0]?.chart_img;
      if (!img) continue;
      const c = charts.find(c => c.data === img);
      if (c) c.labels.push(labelOf[t.id]); else charts.push({ n: charts.length + 1, data: img, labels: [labelOf[t.id]] });
    }
    const relatedIdsOf = (tech) => {
      const group = techGroupOf(tech);
      const kw = [...new Set([tech, group, ...group.split("-")].filter(s => s && s.length >= 2))];
      return techniques.filter(t => kw.some(k => `${t.name || ""} ${t.category || ""} ${(t.tags || []).join(" ")} ${t.rawInput || ""}`.includes(k))).map(t => t.id);
    };
    const items = members.map((t, i) => ({ label: labels[i], trade: t, observe: isObserveTrade(t), relatedIds: relatedIdsOf(t.technique) }));
    let marketSection = "";
    const md = (await sb(`market_data?stock=eq.${encodeURIComponent(base.stock)}&date=eq.${base.date}&select=data&limit=1`).catch(() => []))[0]?.data;
    if (md?.summary) {
      const barsTxt = (md.bars || []).map(b => `${b.date} 시${b.o} 고${b.h} 저${b.l} 종${b.c}${b.cndl ? ` ${b.cndl}(몸통${b.body}%·윗꼬리${b.upw}%·아랫꼬리${b.loww}%)` : ""} (등락 ${b.rate ?? "-"}%, 갭 ${b.gap ?? "-"}%, 장중고점 ${b.hrate ?? "-"}%${b.upper ? ", 상한가마감" : ""}${b.listing ? `, ※상장당일: 등락/갭/고점은 전일종가가 아닌 공모가 ${b.base?.toLocaleString?.() ?? b.base}원 대비` : ""})`).join("\n");
      marketSection = `[KRX 정규장 실제 시세 - 확정 사실]\n${md.summary}\n[일별 시세]\n${barsTxt}\n` +
        `※ 위는 한국거래소 '정규장(09:00~15:30)' 실제 데이터다. 전일 상한가 마감 여부, 지수 국면, 정규장 기준 종가 등락률은 이 수치를 확정 사실로 쓰고, 차트에서 읽은 값이 다르면 이 데이터를 따를 것.\n` +
        `※ [NXT 예외] 차트에 09:00 이전/15:30 이후 캔들이 보이면 NXT 연장거래이며 위 KRX 데이터에 포함되지 않는다. 그 구간의 시가·갭·고저는 차트를 우선해서 해석할 것.\n` +
        `※ 손익은 기록된 매수가·매도가·실현손익 기준.\n\n`;
    }
    const ids = members.map(t => t.id);
    const pastTradesArr = trades.filter(t => !ids.includes(t.id) && t.reason).slice(0, 15);
    const pastTrades = pastTradesArr.map(t => `[ID:${t.id}] ${t.stock}(${t.date}, ${t.pnlRate}%, 기법:${t.technique || "-"}): ${t.reason?.slice(0, 100)}`).join("\n");
    let liveSection = "", sameStockLiveNote = "", liveImgIsSameStock = false;
    const liveImageBlocks = [];
    const liveMatches = lives.filter(t => t.date === base.date && t.category !== "강의");
    if (liveMatches.length) {
      liveSection = liveMatches.map(t => `[${t.stock}]${t.title ? ` ${t.title}` : ""}\n${(t.textContent || "").slice(0, 400)}`).join("\n---\n");
      const sameStock = liveMatches.filter(t => matchStock(t.stock, base.stock));
      if (sameStock.length) {
        liveImgIsSameStock = true;
        sameStockLiveNote = sameStock.map(t => `[교본: ${t.stock}${t.title ? " " + t.title : ""}]\n당일 카톡 원문: ${(t.textContent || "").slice(0, 1400)}`).join("\n---\n");
      }
      for (const t of (sameStock.length ? sameStock : liveMatches)) {
        let imgs = [];
        try { imgs = JSON.parse((await sb(`live_trades?id=eq.${t.id}&select=images`))[0]?.images || "[]").map(x => (typeof x === "string" ? { d: x, s: "" } : { d: x.d, s: x.s || "" })); } catch { imgs = []; }
        const stocks = stockList(t.stock);
        let picked = imgs.filter(im => imgStock(im, stocks) && matchStock(imgStock(im, stocks), base.stock));
        if (!picked.length) picked = imgs;
        picked.slice(0, 3).forEach(im => liveImageBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.d } }));
      }
    }
    const correctionsCtx = corrs.length
      ? `[과거 분석 피드백 - 사용자가 직접 수정한 사례 (최근 ${Math.min(5, corrs.length)}건)]\n비슷한 상황에서 동일한 실수를 반복하지 말 것:\n\n` +
        corrs.slice(0, 5).map((c, i) => `[수정 사례 ${i + 1}]\n❌ 틀린 분석:\n${(c.original_text || "").slice(0, 400)}\n✅ 올바른 분석:\n${(c.corrected_text || "").slice(0, 400)}`).join("\n\n") + "\n\n"
      : "";
    const [y, m, d] = base.date.split("-").map(Number);
    const content = [
      { type: "text", text: STATIC, cache_control: { type: "ephemeral" } },
      ...charts.map(c => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: c.data } })),
      ...liveImageBlocks,
      { type: "text", text: buildSetVariableText({
        stock: base.stock, date: base.date, dayLabel: `(${DAY_NAMES[new Date(y, m - 1, d).getDay()]})`,
        items, charts: charts.map(({ n, labels }) => ({ n, labels })), liveImgCount: liveImageBlocks.length, liveImgIsSameStock,
        marketSection, liveSection, sameStockLiveNote, pastTrades, correctionsCtx,
      }) },
    ];
    if (DRY) {
      const all = await countTokens(content), stat = await countTokens([content[0]]);
      console.log(`[dry] ${key} (${members.length}건, 내 차트 ${charts.length}장, 교본 이미지 ${liveImageBlocks.length}장) · 입력 ${all} 토큰 = 고정(캐시) ${stat} + 가변 ${all - stat}`);
      console.log(`      예상 입력비: 캐시 첫 쓰기 $${((stat * 5 + (all - stat) * 4) / 1e6).toFixed(3)} / 캐시 적중 시 $${((stat * 0.2 + (all - stat) * 4) / 1e6).toFixed(3)}`);
      continue;
    }
    const r = await claude(content);
    if (r.stop === "max_tokens") throw new Error(`출력 한도(${MAX_TOKENS}) 도달 — 응답이 잘려 저장하지 않음`);
    const parsed = parseSetResult(r.text, labels);
    const idOfLabel = Object.fromEntries(members.map((t, i) => [labels[i], t.id]));
    const seqIds = [...parsed.sequence.map(l => idOfLabel[l]), ...ids.filter(id => !parsed.sequence.some(l => idOfLabel[l] === id))];
    await sb("trade_sets", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({
      key, date: base.date, stock: base.stock, trade_ids: seqIds.join(","),
      markers: parsed.markers.map(m => ({ ...m, trade_id: idOfLabel[m.trade] ?? null })),
      analysis: withLec(parsed.setText, parsed.lecture.SET), updated_at: new Date().toISOString(),
    }) });
    for (const t of members) {
      const label = labelOf[t.id];
      await sb(`trades?id=eq.${t.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ai_analysis: withLec(parsed.perTrade[label], parseInt(parsed.lecture[label]) || null) }) });
    }
    const c = costOf(r.usage);
    progress.cost += c;
    progress.done[key] = { at: new Date().toISOString(), cost: +c.toFixed(4), model: r.model, markers: parsed.markers.length, seq: parsed.sequence.join(">") };
    fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
    const u = r.usage;
    console.log(`[${si + 1}/${todo.length}] ✅ ${key} (${members.length}건) ${Math.round((Date.now() - t0) / 1000)}s · 캐시읽기 ${u.cache_read_input_tokens || 0} / 캐시쓰기 ${u.cache_creation_input_tokens || 0} / 일반입력 ${u.input_tokens} / 출력 ${u.output_tokens} · $${c.toFixed(3)} (누적 $${progress.cost.toFixed(2)}) · 순서 ${parsed.sequence.join("→")} · 마커 ${parsed.markers.length}`);
  } catch (e) {
    console.log(`[${si + 1}/${todo.length}] ❌ ${key}: ${e.message}`);
  }
}
console.log(`완료. 누적 비용 약 $${progress.cost.toFixed(2)}`);
