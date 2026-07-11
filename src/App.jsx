import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import JSZip from "jszip";
import * as XLSX from "xlsx";

// ==================== 상수 / 설정 ====================
const TABS = ["🏠 대시보드", "📝 매매일지", "📊 통계", "📚 강의록", "🔴 실전매매"];
const SB_URL = "https://vbdtrynddjryxcpgpisf.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiZHRyeW5kZGpyeXhjcGdwaXNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDI0MDEsImV4cCI6MjA5NTk3ODQwMX0.p3Bs8i-sNz6GodYIXLg1BzdrTxAc9-jB2dZRaOKCW3M";
const HDR = { "Content-Type": "application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Prefer": "resolution=merge-duplicates" };

// ==================== Supabase 유틸 ====================
const sbGet = async (table) => {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?select=*&order=id.asc`, { headers: HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const TRADE_LIST_FIELDS = "id,stock,date,buy_price,sell_price,amount,pnl,pnl_rate,reason,technique,memo,ai_analysis,chart_desc,created_at,deleted_at";
const sbGetTrades = async () => {
  const r = await fetch(`${SB_URL}/rest/v1/trades?select=${TRADE_LIST_FIELDS}&deleted_at=is.null&order=id.asc`, { headers: HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const sbGetTrash = async () => {
  const r = await fetch(`${SB_URL}/rest/v1/trades?select=${TRADE_LIST_FIELDS}&deleted_at=not.is.null&order=deleted_at.desc`, { headers: HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const sbPatch = async (id, data) => {
  const HDR2 = { ...HDR, Prefer: "return=minimal" };
  const r = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${id}`, { method: "PATCH", headers: HDR2, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(await r.text());
};
// 목록 조회 시 이미지(base64)는 제외 - 대용량 payload 타임아웃 방지 (상세에서 지연 로딩)
const LIVE_LIST_FIELDS = "id,title,stock,date,text_content,summary,ai_analysis,created_at,deleted_at";
const sbGetLiveTrades = async () => {
  const r = await fetch(`${SB_URL}/rest/v1/live_trades?select=${LIVE_LIST_FIELDS}&deleted_at=is.null&order=id.desc`, { headers: HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const sbGetLiveImages = async (id) => {
  const r = await fetch(`${SB_URL}/rest/v1/live_trades?id=eq.${id}&select=images`, { headers: HDR });
  if (!r.ok) return [];
  const d = await r.json();
  try { return JSON.parse(d[0]?.images || "[]"); } catch { return []; }
};
const sbPatchLive = async (id, data) => {
  const HDR2 = { ...HDR, Prefer: "return=minimal" };
  const r = await fetch(`${SB_URL}/rest/v1/live_trades?id=eq.${id}`, { method: "PATCH", headers: HDR2, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(await r.text());
};
const sbDeleteOld = async (before) => {
  const r = await fetch(`${SB_URL}/rest/v1/trades?deleted_at=lt.${before}`, { method: "DELETE", headers: HDR });
  if (!r.ok) throw new Error(await r.text());
};
const sbGetChartImg = async (id) => {
  const r = await fetch(`${SB_URL}/rest/v1/trades?id=eq.${id}&select=chart_img`, { headers: HDR });
  if (!r.ok) return null;
  const d = await r.json();
  return d[0]?.chart_img || null;
};
const sbUpsert = async (table, rows) => {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: HDR, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(await r.text());
};
const sbDelete = async (table, id) => {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: HDR });
  if (!r.ok) throw new Error(await r.text());
};
const sbGetCorrections = async () => {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/analysis_corrections?select=*&order=created_at.desc&limit=10`, { headers: HDR });
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
};
const sbAddCorrection = async (original, corrected) => {
  const r = await fetch(`${SB_URL}/rest/v1/analysis_corrections`, {
    method: "POST",
    headers: { ...HDR, Prefer: "return=minimal" },
    body: JSON.stringify({ original_text: original, corrected_text: corrected }),
  });
  if (!r.ok) throw new Error(await r.text());
};

const liveTradeToRow = (t) => ({
  id: t.id, title: t.title || null, stock: t.stock, date: t.date,
  text_content: t.textContent,
  images: JSON.stringify(t.images || []),
  ai_analysis: t.aiAnalysis || null,
  summary: t.summary || null,
  created_at: t.createdAt,
  deleted_at: t.deletedAt || null,
});
const rowToLiveTrade = (r) => ({
  id: r.id, title: r.title || null, stock: r.stock, date: r.date,
  textContent: r.text_content,
  images: (() => { try { return JSON.parse(r.images || "[]"); } catch { return []; } })(),
  aiAnalysis: r.ai_analysis,
  summary: r.summary || null,
  createdAt: r.created_at,
  deletedAt: r.deleted_at || null,
});
const techToRow = (t) => ({ id: t.id, name: t.name, category: t.category, timeframe: t.timeframe, entry: t.entry, exit: t.exit, pattern: t.pattern, tags: t.tags, notes: t.notes, raw_input: t.rawInput, created_at: t.createdAt });
const rowToTech = (r) => ({ id: r.id, name: r.name, category: r.category, timeframe: r.timeframe, entry: r.entry, exit: r.exit, pattern: r.pattern, tags: r.tags, notes: r.notes, rawInput: r.raw_input, createdAt: r.created_at });
const tradeToRow = (t) => ({ id: t.id, stock: t.stock, date: t.date, buy_price: t.buyPrice, sell_price: t.sellPrice, amount: t.amount, pnl: t.pnl, pnl_rate: t.pnlRate, reason: t.reason, technique: t.technique, memo: t.memo, chart_img: t.chartImg, ai_analysis: t.aiAnalysis, chart_desc: t.chartDesc, created_at: t.createdAt });
const rowToTrade = (r) => ({ id: r.id, stock: r.stock, date: r.date, buyPrice: r.buy_price, sellPrice: r.sell_price, amount: r.amount, pnl: r.pnl, pnlRate: r.pnl_rate, reason: r.reason, technique: r.technique, memo: r.memo, chartImg: r.chart_img, aiAnalysis: r.ai_analysis, chartDesc: r.chart_desc, createdAt: r.created_at, deletedAt: r.deleted_at || null });

// ==================== 매매 카테고리 ====================
const TRADE_CATEGORIES = [
  "상따",
  "양봉종배",
  "음봉매매-시초",
  "음봉매매-종배",
  "상한가하락시작-시초",
  "장중매매-돌파",
  "장중매매-눌림지지",
  "투매-시초",
  "투매-종가",
  "투경해제",
  "단기과열",
  "무증매매",
  "악재매매",
  "기타",
];

// 매매 카테고리를 기법군(예: "투매")과 진입시점(예: "시초")으로 분리
const TIMING_SUFFIXES = ["시초", "종배", "종가"];
const techGroupOf = (technique) => {
  if (!technique) return "미분류";
  const i = technique.lastIndexOf("-");
  if (i === -1) return technique;
  return TIMING_SUFFIXES.includes(technique.slice(i + 1)) ? technique.slice(0, i) : technique;
};
const techTimingOf = (technique) => {
  if (!technique) return "기타";
  const i = technique.lastIndexOf("-");
  if (i === -1) return "기타";
  const suffix = technique.slice(i + 1);
  return TIMING_SUFFIXES.includes(suffix) ? suffix : "기타";
};
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const dayOfWeek = (dateStr) => {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getDay();
};

// ==================== 공통 유틸 ====================
const categoryColor = (cat) => {
  if (!cat) return "#7f8c8d";
  if (cat.startsWith("장중매매")) return "#2980b9";
  if (cat.startsWith("음봉매매")) return "#8e44ad";
  if (cat.startsWith("투매")) return "#2980b9";
  if (cat.startsWith("상한가하락시작")) return "#c0392b";
  return ({
    "상따": "#e74c3c",
    "양봉종배": "#e67e22",
    "투경해제": "#27ae60",
    "단기과열": "#f39c12",
    "무증매매": "#16a085",
    "악재매매": "#7f8c8d",
    "기타": "#555",
  }[cat] || "#7f8c8d");
};
const pnlColor = (v) => v > 0 ? "#4caf50" : v < 0 ? "#e74c3c" : "#aaa";
const autoCalc = (form, field, value) => {
  const next = { ...form, [field]: value };
  const buy = parseFloat(next.buyPrice) || 0;
  const sell = parseFloat(next.sellPrice) || 0;
  const amt = parseFloat(next.amount) || 0;
  if (field === "buyPrice" || field === "sellPrice") {
    if (buy > 0 && sell > 0) {
      next.pnlRate = parseFloat(((sell - buy) / buy * 100).toFixed(2));
      if (amt > 0) next.pnl = Math.round(amt * (sell - buy) / buy);
    }
  } else if (field === "amount") {
    if (amt > 0) {
      if (buy > 0 && sell > 0) next.pnl = Math.round(amt * (sell - buy) / buy);
      else if (parseFloat(next.pnlRate)) next.pnl = Math.round(amt * parseFloat(next.pnlRate) / 100);
    }
  } else if (field === "pnlRate") {
    const rate = parseFloat(value) || 0;
    if (amt > 0 && rate !== 0) next.pnl = Math.round(amt * rate / 100);
  } else if (field === "pnl") {
    const pnlVal = parseFloat(value) || 0;
    if (amt > 0 && pnlVal !== 0) next.pnlRate = parseFloat((pnlVal / amt * 100).toFixed(2));
  }
  return next;
};
const fmtNum = (v) => {
  if (v === "" || v == null) return "";
  const s = String(v).replace(/,/g, "");
  if (s === "-") return "-";
  const n = parseFloat(s);
  return isNaN(n) ? "" : Math.round(n).toLocaleString("ko-KR");
};

const filterKakaoText = (raw) => {
  const lines = raw.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^\[용\]/.test(trimmed)) {
      // [용] 제거 후 타임스탬프([오전 9:45] 등)도 제거한 실제 내용
      const content = trimmed.replace(/^\[용\]/, '').replace(/^\s*\[[^\]]+\]/, '').trim();
      if (content !== '사진') kept.push(trimmed);
    }
  }
  return kept.join('\n');
};

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY || "";
const claude = async (system, userContent, maxTokens = 1000, temperature, model = "claude-sonnet-4-6") => {
  const headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
  if (ANTHROPIC_KEY) headers["x-api-key"] = ANTHROPIC_KEY;
  const body = JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: userContent }], ...(temperature !== undefined ? { temperature } : {}) });
  const RETRYABLE = new Set([500, 529]);
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body });
    } catch (e) { throw new Error(`네트워크 오류 (CORS/연결): ${e.message}`); }
    if (res.ok) {
      const data = await res.json();
      return data.content?.map(b => b.text || "").join("") || "";
    }
    if (RETRYABLE.has(res.status) && attempt < 2) {
      const wait = res.status === 529 ? 8000 : 4000;
      await new Promise(r => setTimeout(r, wait * (attempt + 1)));
      continue;
    }
    let msg = res.status;
    try { const d = await res.json(); msg = d.error?.message || msg; } catch {}
    throw new Error(`API 오류 ${res.status}: ${msg}`);
  }
};
const parseJSON = async (text) => {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error("JSON 없음");
  try { return JSON.parse(m[0]); } catch {}
  try {
    const fixed = m[0].replace(/:\s*"([\s\S]*?)(?<!\\)"(?=\s*[,}\]])/g, (_, v) =>
      `: "${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "").replace(/\t/g, "\\t")}"`);
    return JSON.parse(fixed);
  } catch {}
  try {
    const cleaned = m[0].replace(/,\s*([}\]])/g, "$1").replace(/([{,]\s*)(\w+):/g, '$1"$2":');
    return JSON.parse(cleaned);
  } catch {}
  throw new Error("AI 응답 파싱 실패. 이미지를 다시 붙여넣어 주세요.");
};
const toBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = () => rej(new Error("파일 읽기 실패")); r.readAsDataURL(file); });

// 텍스트 OCR용: JPEG 고품질(0.98) 변환 (한글 글자 오독 방지 - PNG보다 파일 크기 안전)
const compressImageForOCR = (file, maxPx = 3000) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("파일 읽기 실패"));
  reader.onload = (ev) => {
    const img = new Image();
    img.onerror = () => reject(new Error("이미지 로드 실패"));
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.98).split(",")[1]);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// 이미지를 JPEG로 압축/리사이즈 (대용량 이미지 → API 요청 크기 초과 방지)
const compressImage = (file, maxPx = 2048) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("파일 읽기 실패"));
  reader.onload = (ev) => {
    const img = new Image();
    img.onerror = () => reject(new Error("이미지 로드 실패"));
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

const b64ToFile = (b64, mime) => {
  const bytes = atob(b64); const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([new Blob([arr], { type: mime })], "img", { type: mime });
};

const parsePptxToSlides = async (file) => {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const ALLOWED_EXT = ["png","jpg","jpeg","gif","bmp","webp"];

  const slideKeys = Object.keys(zip.files)
    .filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);

  return Promise.all(slideKeys.map(async key => {
    const xml = await zip.files[key].async("text");
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
      .map(m => m[1]).filter(t => t.trim()).join("\n");

    const relsKey = key.replace("slides/slide", "slides/_rels/slide").replace(".xml", ".xml.rels");
    const images = [];
    if (zip.files[relsKey]) {
      const relsXml = await zip.files[relsKey].async("text");
      for (const rel of [...relsXml.matchAll(/<Relationship[^>]+>/g)]) {
        if (!/\/image"/.test(rel[0])) continue;
        const t = rel[0].match(/Target="\.\.\/media\/([^"]+)"/);
        if (!t) continue;
        const ext = t[1].split(".").pop().toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) continue;
        const mKey = `ppt/media/${t[1]}`;
        if (!zip.files[mKey]) continue;
        const b64 = await zip.files[mKey].async("base64");
        const mime = ["jpg","jpeg"].includes(ext) ? "image/jpeg" : `image/${ext}`;
        images.push({ b64, mime });
      }
    }
    return { texts, images };
  }));
};

const parseXlsCsvToTrades = async (file) => {
  const ext = file.name.split('.').pop().toLowerCase();
  const num = s => parseFloat(String(s || 0).replace(/,/g, '').replace(/^'/, '')) || 0;
  // 따옴표 안의 쉼표를 올바르게 처리하는 CSV 파서
  const csvLine = (line) => {
    const fields = []; let field = ''; let inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { fields.push(field.trim()); field = ''; }
      else { field += c; }
    }
    fields.push(field.trim());
    return fields;
  };
  let rows = [];
  if (ext === 'csv') {
    let text = await file.text();
    if (!text.includes('종목')) {
      text = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej;
        r.readAsText(file, 'EUC-KR');
      });
    }
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const hi = lines.findIndex(l => l.includes('종목명'));
    if (hi === -1) throw new Error('종목명 컬럼 없음');
    const headers = csvLine(lines[hi]);
    for (let i = hi + 1; i < lines.length; i++) {
      const vals = csvLine(lines[i]);
      if (!vals.some(Boolean)) continue;
      const row = {}; headers.forEach((h, j) => { row[h] = vals[j] || ''; });
      rows.push(row);
    }
  } else {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });
  }

  // 컬럼명 정규화 (키움 형식 포함)
  const mapped = rows
    .filter(r => r['종목명'] || r['종목'])
    .map(r => ({
      stock: (r['종목명'] || r['종목'] || '').replace(/^[*']/, '').trim(),
      date: (r['일자'] || r['날짜'] || '').replace(/\//g, '-').trim(),
      qty: num(r['수량']),
      buyAmt: num(r['매입금액'] || r['매수금액']),
      sellAmt: num(r['매도금액'] || r['매도체결금액']),
      buyPrice: num(r['매입가'] || r['매입단가'] || r['매수가'] || r['매입가격'] || r['평균매입가']),
      sellPrice: num(r['매도체결가'] || r['매도단가'] || r['매도가'] || r['매도가격']),
      pnl: num(r['실현손익'] || r['매매손익'] || r['손익금액']),
    }))
    .filter(r => r.stock);

  // 날짜 + 종목명으로 그룹핑 후 머지
  const groups = {};
  for (const r of mapped) {
    const key = `${r.date}|${r.stock}`;
    (groups[key] = groups[key] || []).push(r);
  }

  return Object.values(groups).map(grp => {
    const totalQty  = grp.reduce((s, r) => s + r.qty, 0);
    const totalBuy  = grp.reduce((s, r) => s + r.buyAmt, 0);
    const totalSell = grp.reduce((s, r) => s + r.sellAmt, 0);
    const totalPnl  = grp.reduce((s, r) => s + r.pnl, 0);
    // 가중평균: Σ금액 / Σ수량
    const avgBuyPrice  = totalQty > 0 ? totalBuy  / totalQty : grp[0].buyPrice;
    const avgSellPrice = totalQty > 0 ? totalSell / totalQty : grp[0].sellPrice;
    // 수익률 = 실현손익 / 매입금액 × 100
    const pnlRate = totalBuy > 0 ? (totalPnl / totalBuy) * 100 : 0;
    return {
      stock: grp[0].stock,
      date: grp[0].date,
      buyPrice:  Math.round(avgBuyPrice),
      sellPrice: Math.round(avgSellPrice),
      pnl:       Math.round(totalPnl),
      pnlRate:   parseFloat(pnlRate.toFixed(2)),
      buyAmount: Math.round(totalBuy),
    };
  });
};

const box = { background: "#1a1d27", borderRadius: 10, border: "1px solid #2a2d3a", padding: "14px 16px" };
const label11 = { fontSize: 11, color: "#555", marginBottom: 3, textAlign: "left" };
const val14 = { fontSize: 14, color: "#ddd", background: "#13151f", padding: "8px 10px", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.6, textAlign: "left" };

const useIsMobile = () => {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w < 640;
};

// 상세보기에서 목록으로 돌아갈 때, 직전에 보던 항목이 화면 맨 위에 보이도록 스크롤 위치 복원
const useScrollRestore = (view) => {
  const targetIdRef = useRef(null);
  useLayoutEffect(() => {
    if (view !== "list" || !targetIdRef.current) return;
    const id = targetIdRef.current;
    targetIdRef.current = null;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
  }, [view]);
  return targetIdRef;
};

// ==================== 대시보드 탭 ====================
function DashboardTab({ onNavigate }) {
  const [trades, setTrades] = useState([]);
  const [techniques, setTechniques] = useState([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    Promise.all([sbGetTrades(), sbGet("techniques")])
      .then(([tr, te]) => { setTrades(tr.map(rowToTrade).filter(t => !t.deletedAt)); setTechniques(te.map(rowToTech)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: "#555", padding: 40, textAlign: "center" }}>로딩 중...</div>;

  const scored = trades.filter(t => t.pnlRate !== "" && t.pnlRate != null && t.pnlRate !== undefined);
  const total = scored.length;
  const wins = scored.filter(t => parseFloat(t.pnlRate) > 0).length;
  const losses = scored.filter(t => parseFloat(t.pnlRate) < 0).length;
  const winRate = total ? ((wins / total) * 100).toFixed(1) : 0;
  const totalPnl = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  const avgWin = wins ? (scored.filter(t => parseFloat(t.pnlRate) > 0).reduce((s, t) => s + parseFloat(t.pnlRate), 0) / wins).toFixed(2) : 0;
  const avgLoss = losses ? (scored.filter(t => parseFloat(t.pnlRate) < 0).reduce((s, t) => s + parseFloat(t.pnlRate), 0) / losses).toFixed(2) : 0;
  const recent5 = [...trades].sort((a, b) => b.id - a.id).slice(0, 5);

  // 월별 손익
  const byMonth = {};
  trades.forEach(t => {
    const m = (t.date || "").slice(0, 7);
    if (!m) return;
    if (!byMonth[m]) byMonth[m] = 0;
    byMonth[m] += parseFloat(t.pnl) || 0;
  });
  const months = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);

  // 기법별 승률 (수익률 있는 종목만)
  const byTech = {};
  scored.forEach(t => {
    const k = t.technique || "미분류";
    if (!byTech[k]) byTech[k] = { total: 0, wins: 0 };
    byTech[k].total++; if (parseFloat(t.pnlRate) > 0) byTech[k].wins++;
  });

  const maxAbs = months.length ? Math.max(...months.map(([, v]) => Math.abs(v)), 1) : 1;

  return (
    <div style={{ color: "#e0e0e0" }}>
      {/* KPI 카드 */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
        {[
          ["총 매매", total, "#ddd"],
          ["승률", `${winRate}%`, parseFloat(winRate) >= 50 ? "#4caf50" : "#e74c3c"],
          ["총 손익", `${totalPnl >= 0 ? "+" : ""}${totalPnl.toLocaleString()}원`, pnlColor(totalPnl)],
          ["강의록 기법", `${techniques.length}개`, "#4f8ef7"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ ...box, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
        {/* 평균 수익/손실 */}
        <div style={box}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>평균 수익 / 손실</div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1, background: "#13151f", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>평균 수익률</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#4caf50" }}>+{avgWin}%</div>
            </div>
            <div style={{ flex: 1, background: "#13151f", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>평균 손실률</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#e74c3c" }}>{avgLoss}%</div>
            </div>
          </div>
        </div>

        {/* 기법별 승률 */}
        <div style={box}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>기법별 승률</div>
          {Object.keys(byTech).length === 0
            ? <div style={{ fontSize: 12, color: "#555" }}>데이터 없음</div>
            : Object.entries(byTech).map(([k, v]) => {
              const wr = ((v.wins / v.total) * 100).toFixed(0);
              return (
                <div key={k} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: "#ccc" }}>{k}</span>
                    <span style={{ color: parseFloat(wr) >= 50 ? "#4caf50" : "#e74c3c" }}>{wr}% ({v.total}건)</span>
                  </div>
                  <div style={{ background: "#13151f", borderRadius: 4, height: 5, overflow: "hidden" }}>
                    <div style={{ width: `${wr}%`, height: "100%", background: parseFloat(wr) >= 50 ? "#4caf50" : "#e74c3c", borderRadius: 4 }} />
                  </div>
                </div>
              );
            })
          }
        </div>
      </div>

      {/* 월별 손익 바 차트 */}
      {months.length > 0 && (
        <div style={{ ...box, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>월별 손익</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80 }}>
            {months.map(([m, v]) => {
              const h = Math.max((Math.abs(v) / maxAbs) * 70, 4);
              return (
                <div key={m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  {v >= 0
                    ? <><div style={{ width: "100%", height: h, background: "#4caf50", borderRadius: "3px 3px 0 0" }} /><div style={{ height: 4 }} /></>
                    : <><div style={{ height: 74 - h }} /><div style={{ width: "100%", height: h, background: "#e74c3c", borderRadius: "0 0 3px 3px" }} /></>
                  }
                  <div style={{ fontSize: 10, color: "#555", whiteSpace: "nowrap" }}>{m.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 최근 매매 */}
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>최근 매매</div>
          <button onClick={() => onNavigate(1)} style={{ background: "none", border: "none", color: "#4f8ef7", cursor: "pointer", fontSize: 12 }}>전체 보기 →</button>
        </div>
        {recent5.length === 0
          ? <div style={{ fontSize: 12, color: "#555" }}>매매 기록 없음</div>
          : recent5.map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #1e2130" }}>
              <span style={{ fontWeight: 600, fontSize: 14, minWidth: 80 }}>{t.stock}</span>
              <span style={{ fontSize: 12, color: "#555" }}>{t.date}</span>
              {t.technique && <span style={{ background: "#2a2d3a", fontSize: 11, padding: "1px 6px", borderRadius: 4, color: "#aaa" }}>{t.technique}</span>}
              <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14, color: pnlColor(parseFloat(t.pnlRate)) }}>
                {parseFloat(t.pnlRate) > 0 ? "+" : ""}{t.pnlRate}%
              </span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

const LECTURE_SYSTEM = `당신은 단기 주식 매매 강의록을 구조화하는 전문가다. 주어진 강의록 원문에서 실전 매매에 필요한 정보를 빠짐없이 추출하여 JSON으로 정리한다.

[원칙]
- 입력 전처리: 인사말/감사/광고/잡담 제거.
- 원문의 구체적 수치를 절대 누락하지 말 것: 매수/매도 % 기준, 손절(-%), 익절(+%), 비중(만원/%), 거래대금 기준, 시간대(오전상/10시/3시20분 등), 분할 횟수 등.
- 원문에 없는 내용은 지어내지 말 것. 근거 없으면 빈 문자열("").
- 실전에서 바로 적용 가능하도록 조건과 수치를 명확히 서술.

[출력 JSON 스키마 - 이 구조만 출력]
{"name":"기법 이름","category":"기법 분류(예: 상따, 음봉매매, 종가배팅, 눌림매수, 저평가매수, 상한가하락시작 등. 복합이면 / 로 구분)","timeframe":"사용 봉/시간대","entry":{"condition":"매수 진입 조건(종목선정 기준 포함, 수치와 함께)","position":"매수 타점/비중(분할매수 방식, 금액/비율)","caution":"매수 주의사항/제외 조건"},"exit":{"profit":"익절 기준·분할매도 방식(구체적 %와 횟수)","loss":"손절 기준(구체적 % 및 상황)"},"pattern":{"before":"진입 직전 차트/시장 상황","trigger":"매수 실행 방아쇠 조건","after":"진입 후 예상 흐름 및 대응"},"tags":["검색용 키워드 5~12개"],"notes":"핵심 인사이트·매매 심리·꼭 지킬 원칙(3~6줄, 줄바꿈은 \\n)"}

[JSON 형식 필수 규칙]
- 문자열 값 안에서 큰따옴표(") 금지. 강조는 작은따옴표(') 또는 「」 사용.
- 값 안 줄바꿈은 반드시 \\n 으로 이스케이프.
- 반드시 유효한 JSON만 출력. 코드블록/설명 금지.`;

function LectureTab() {
  const [techniques, setTechniques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editSubMode, setEditSubMode] = useState("raw");
  const [editJson, setEditJson] = useState("");
  const [editRaw, setEditRaw] = useState("");
  const [feedback, setFeedback] = useState("");
  const [view, setView] = useState("list");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const scrollTargetRef = useScrollRestore(view);
  const isMobile = useIsMobile();
  const techsRef = useRef([]);
  const selectedRef = useRef(null);
  useEffect(() => { techsRef.current = techniques; }, [techniques]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const load = useCallback(async () => {
    setLoading(true);
    try { const rows = await sbGet("techniques"); setTechniques(rows.map(rowToTech)); }
    catch (e) { setFeedback(`❌ 로드 실패: ${e.message}`); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openDetail = (t) => {
    if (window.history.state?.techId !== t.id)
      window.history.pushState({ ...(window.history.state || {}), techView: "detail", techId: t.id }, "");
    setSelected(t); setView("detail"); setFeedback("");
  };
  const backToList = () => {
    window.history.replaceState({ ...(window.history.state || {}), techView: "list", techId: undefined }, "");
    if (selected) scrollTargetRef.current = `tech-row-${selected.id}`;
    setView("list"); setSelected(null); setEditMode(false); setFeedback(""); setDeleteConfirm(false);
  };

  // 브라우저 뒤로가기: 상세 → 목록
  useEffect(() => {
    window.history.replaceState({ ...(window.history.state || {}), techView: "list" }, "");
    const handlePop = (e) => {
      const s = e.state || {};
      if (s.techView === "detail" && s.techId) {
        const t = techsRef.current.find(x => x.id === s.techId);
        if (t) { setSelected(t); setView("detail"); setFeedback(""); }
      } else if (selectedRef.current) {
        scrollTargetRef.current = `tech-row-${selectedRef.current.id}`;
        setView("list"); setSelected(null); setEditMode(false); setFeedback(""); setDeleteConfirm(false);
      }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extractPdf = async (file) => {
    const b64 = await toBase64(file);
    return claude("PDF에서 매매 기법 관련 텍스트만 추출. 광고/인사말/URL 제거. plain text만 출력.", [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
      { type: "text", text: "매매 기법 텍스트 추출해주세요." }
    ], 5000);
  };

  const handleAdd = async () => {
    if (!input.trim()) return;
    setSaving(true); setFeedback("");
    try {
      const raw = await claude(LECTURE_SYSTEM, input, 4000, undefined, "claude-fable-5");
      const parsed = await parseJSON(raw);
      parsed.id = Date.now(); parsed.createdAt = new Date().toLocaleDateString("ko-KR"); parsed.rawInput = input;
      await sbUpsert("techniques", [techToRow(parsed)]);
      setTechniques(p => [...p, parsed]);
      setInput(""); setFeedback("✅ 저장됨"); setView("list");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try { await sbDelete("techniques", id); setTechniques(p => p.filter(t => t.id !== id)); setSelected(null); setView("list"); }
    catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleEditSave = async () => {
    try {
      const updated = JSON.parse(editJson);
      await sbUpsert("techniques", [techToRow(updated)]);
      setTechniques(p => p.map(t => t.id === updated.id ? updated : t));
      setSelected(updated); setEditMode(false); setFeedback("✅ 저장됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleRawSave = async () => {
    const updated = { ...selected, rawInput: editRaw };
    try {
      await sbUpsert("techniques", [techToRow(updated)]);
      setTechniques(p => p.map(t => t.id === updated.id ? updated : t));
      setSelected(updated); setEditMode(false); setFeedback("✅ 저장됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handlePdf = async (e, target) => {
    const file = e.target.files[0]; if (!file) return;
    setPdfLoading(target); setFeedback("");
    try {
      const text = await extractPdf(file);
      if (target === "add") setInput(p => p ? p + "\n\n" + text : text);
      else setEditRaw(text);
      setFeedback("✅ PDF 추출 완료");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setPdfLoading(false); e.target.value = "";
  };

  const tabBtn = (active, onClick, label) => (
    <button onClick={onClick} style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, background: active ? "#4f8ef7" : "#2a2d3a", color: active ? "#fff" : "#aaa" }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {tabBtn(view === "list" && !selected, () => { setView("list"); setSelected(null); setFeedback(""); }, `기법 목록 (${techniques.length})`)}
        {tabBtn(view === "add", () => { setView("add"); setSelected(null); setFeedback(""); }, "기법 추가")}
        <button onClick={load} style={{ marginLeft: "auto", padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>🔄</button>
      </div>

      {loading && <div style={{ color: "#555", padding: 40, textAlign: "center" }}>로딩 중...</div>}

      {!loading && view === "add" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center" }}>
            <label style={{ padding: "6px 14px", background: "#2a2d3a", color: "#aaa", borderRadius: 6, cursor: "pointer", fontSize: 13, border: "1px solid #3a3d4a" }}>
              📎 PDF <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => handlePdf(e, "add")} />
            </label>
            {pdfLoading === "add" && <span style={{ fontSize: 13, color: "#aaa" }}>⏳ 추출 중...</span>}
          </div>
          <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="기법을 자연어로 설명하세요..."
            style={{ width: "100%", minHeight: 140, background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: 8, color: "#e0e0e0", padding: 14, fontSize: 14, resize: "vertical", boxSizing: "border-box", textAlign: "left" }} />
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <button onClick={handleAdd} disabled={saving} style={{ padding: "8px 20px", background: saving ? "#333" : "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              {saving ? "분석 중..." : "저장"}
            </button>
            {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
          </div>
        </div>
      )}

      {!loading && view === "list" && !selected && (
        techniques.length === 0
          ? <div style={{ color: "#555", marginTop: 40, textAlign: "center" }}>저장된 기법 없음</div>
          : <div style={{ display: "grid", gap: 10 }}>
            {techniques.map(t => (
              <div key={t.id} id={`tech-row-${t.id}`} onClick={() => openDetail(t)}
                style={{ ...box, cursor: "pointer", scrollMarginTop: isMobile ? 90 : 50 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#4f8ef7"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2d3a"}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: categoryColor(t.category), color: "#fff", fontSize: 11, padding: "2px 7px", borderRadius: 4 }}>{t.category}</span>
                  <span style={{ fontWeight: 600 }}>{t.name}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>{t.createdAt}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "#777", textAlign: "left" }}>{t.entry?.condition?.slice(0, 80)}...</div>
                <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {t.tags?.map(tag => <span key={tag} style={{ background: "#2a2d3a", fontSize: 11, padding: "1px 6px", borderRadius: 4, color: "#aaa" }}>#{tag}</span>)}
                </div>
              </div>
            ))}
          </div>
      )}

      {!loading && view === "detail" && selected && (
        <div>
          <button onClick={backToList}
            style={{ background: "none", border: "none", color: "#4f8ef7", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>← 목록</button>
          {!editMode ? (
            <div style={box}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ background: categoryColor(selected.category), color: "#fff", fontSize: 11, padding: "2px 7px", borderRadius: 4 }}>{selected.category}</span>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{selected.name}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => { setEditJson(JSON.stringify(selected, null, 2)); setEditRaw(selected.rawInput || ""); setEditSubMode("raw"); setEditMode(true); }}
                    style={{ padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>수정</button>
                  {deleteConfirm ? (
                    <>
                      <span style={{ fontSize: 12, color: "#e74c3c" }}>삭제하시겠습니까?</span>
                      <button onClick={() => handleDelete(selected.id)}
                        style={{ padding: "4px 10px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>확인</button>
                      <button onClick={() => setDeleteConfirm(false)}
                        style={{ padding: "4px 10px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>취소</button>
                    </>
                  ) : (
                    <button onClick={() => setDeleteConfirm(true)}
                      style={{ padding: "4px 10px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>삭제</button>
                  )}
                </div>
              </div>
              {[["📌 매수 조건", selected.entry?.condition], ["📍 매수 위치", selected.entry?.position],
                ["⚠️ 주의", selected.entry?.caution], ["✅ 익절", selected.exit?.profit],
                ["🛑 손절", selected.exit?.loss], ["📈 매수 전", selected.pattern?.before],
                ["⚡ 트리거", selected.pattern?.trigger], ["🔮 예상 흐름", selected.pattern?.after],
                ["📝 메모", selected.notes], ["📄 원본", selected.rawInput],
              ].map(([lbl, content]) => content ? (
                <div key={lbl} style={{ marginBottom: 10 }}>
                  <div style={label11}>{lbl}</div>
                  <div style={val14}>{content}</div>
                </div>
              ) : null)}
              <div style={{ marginTop: 10, display: "flex", gap: 5, flexWrap: "wrap" }}>
                {selected.tags?.map(tag => <span key={tag} style={{ background: "#2a2d3a", fontSize: 12, padding: "2px 7px", borderRadius: 4, color: "#aaa" }}>#{tag}</span>)}
              </div>
              {feedback && <div style={{ marginTop: 8, fontSize: 13, color: "#4caf50" }}>{feedback}</div>}
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {["raw", "json"].map(m => (
                  <button key={m} onClick={() => setEditSubMode(m)}
                    style={{ padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, background: editSubMode === m ? "#4f8ef7" : "#2a2d3a", color: editSubMode === m ? "#fff" : "#aaa" }}>
                    {m === "raw" ? "원본 텍스트" : "JSON 수정"}
                  </button>
                ))}
              </div>
              {editSubMode === "raw" ? (
                <div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
                    <label style={{ padding: "5px 12px", background: "#2a2d3a", color: "#aaa", borderRadius: 6, cursor: "pointer", fontSize: 13, border: "1px solid #3a3d4a" }}>
                      📎 PDF <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => handlePdf(e, "edit")} />
                    </label>
                    {pdfLoading === "edit" && <span style={{ fontSize: 13, color: "#aaa" }}>⏳ 추출 중...</span>}
                  </div>
                  <textarea value={editRaw} onChange={e => setEditRaw(e.target.value)} placeholder="원본 텍스트..."
                    style={{ width: "100%", minHeight: 180, background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 8, color: "#e0e0e0", padding: 12, fontSize: 13, resize: "vertical", boxSizing: "border-box", textAlign: "left" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <button onClick={handleRawSave} style={{ padding: "6px 16px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
                    <button onClick={() => setEditMode(false)} style={{ padding: "6px 16px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>취소</button>
                    {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
                  </div>
                </div>
              ) : (
                <div>
                  <textarea value={editJson} onChange={e => setEditJson(e.target.value)}
                    style={{ width: "100%", minHeight: 360, background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 8, color: "#e0e0e0", padding: 12, fontSize: 12, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box", textAlign: "left" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <button onClick={handleEditSave} style={{ padding: "6px 16px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
                    <button onClick={() => setEditMode(false)} style={{ padding: "6px 16px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>취소</button>
                    {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== 매매일지 탭 ====================
function JournalTab({ techniques }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list");
  const [inputMode, setInputMode] = useState("img0606");
  const [form, setForm] = useState({ stock: "", date: "", buyPrice: "", sellPrice: "", amount: "", pnl: "", pnlRate: "", reason: "", technique: "", memo: "", chartDesc: "" });
  const [imgLoading, setImgLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState(null);
  const [chartImg, setChartImg] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [pending0397, setPending0397] = useState([]);
  const [bulk0397Date, setBulk0397Date] = useState("");
  const [showStockDrop, setShowStockDrop] = useState(false);
  const [editTrade, setEditTrade] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editImgLoading, setEditImgLoading] = useState(false);
  const [sel0397, setSel0397] = useState(new Set());
  const [expanded0397, setExpanded0397] = useState(null);
  const [pendingPpt, setPendingPpt] = useState([]);
  const [pptLoading, setPptLoading] = useState(false);
  const [pptProgress, setPptProgress] = useState("");
  const [detailImgLoading, setDetailImgLoading] = useState(false);
  const [fill0397Loading, setFill0397Loading] = useState(false);
  const [editPasteMode, setEditPasteMode] = useState("0606");
  const [groupByDate, setGroupByDate] = useState(true);
  const [scrollToDate, setScrollToDate] = useState(null);
  const [detailAiAnalysis, setDetailAiAnalysis] = useState("");
  const [detailAiLoading, setDetailAiLoading] = useState(false);
  const [aiEditMode, setAiEditMode] = useState(false);
  const [aiEditText, setAiEditText] = useState("");
  const [similarTrades, setSimilarTrades] = useState([]);
  const [listTab, setListTab] = useState("trades");
  const [trashTrades, setTrashTrades] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [trashSelectMode, setTrashSelectMode] = useState(false);
  const [trashSelectedIds, setTrashSelectedIds] = useState(new Set());
  const [sortBy, setSortBy] = useState("date_desc");
  const [techFilter, setTechFilter] = useState(new Set());
  const [showTechDrop, setShowTechDrop] = useState(false);
  const pasteZoneRef = useRef(null);
  const tradesRef = useRef([]);
  const selectedRef = useRef(null);
  const analysisCacheRef = useRef({});
  const scrollTargetRef = useScrollRestore(view);
  const isMobile = useIsMobile();

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    if (view === "add" && (inputMode === "img0606" || inputMode === "img0397")) {
      pasteZoneRef.current?.focus();
    }
  }, [view, inputMode]);

  // 날짜 이동: 날짜별 보기로 전환 후 해당 날짜 섹션으로 스크롤
  useEffect(() => {
    if (!scrollToDate) return;
    const el = document.getElementById(`date-sec-${scrollToDate}`);
    if (el) {
      el.scrollIntoView({ behavior: "auto", block: "start" });
      setFeedback("");
    } else {
      setFeedback(`❌ ${scrollToDate} 매매 기록 없음`);
    }
    setScrollToDate(null);
  }, [scrollToDate, trades, groupByDate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await sbGetTrades();
      const loaded = rows.map(rowToTrade).sort((a,b) => (b.date||"").localeCompare(a.date||"") || b.id - a.id);
      setTrades(loaded);
      tradesRef.current = loaded;
    }
    catch (e) { setFeedback(`❌ 로드 실패: ${e.message}`); }
    setLoading(false);
  }, []);

  // AI 분석/유사매매 결과를 매매별로 캐싱해, 다른 매매를 보고 돌아와도 결과가 바뀌지 않도록 복원
  const restoreAnalysisFor = (trade, allTrades) => {
    const cached = analysisCacheRef.current[trade.id];
    if (cached) {
      setDetailAiAnalysis(cached.text);
      setSimilarTrades(cached.similarIds.map(id => allTrades.find(x => x.id === id)).filter(Boolean));
    } else {
      setDetailAiAnalysis("");
      setSimilarTrades(trade.aiAnalysis ? calcSimilarTrades(trade, allTrades) : []);
    }
  };

  const openDetail = async (trade) => {
    window.history.pushState({ ...(window.history.state || {}), journalView: "detail", journalId: trade.id }, "");
    setSelected(trade); setView("detail"); setFeedback(""); setEditTrade(false);
    restoreAnalysisFor(trade, trades);
    setDetailImgLoading(true);
    const img = await sbGetChartImg(trade.id);
    setSelected(prev => prev?.id === trade.id ? { ...prev, chartImg: img } : prev);
    setDetailImgLoading(false);
  };
  useEffect(() => { load(); }, [load]);

  // 브라우저 뒤로가기/앞으로가기 처리
  useEffect(() => {
    window.history.replaceState({ ...(window.history.state || {}), journalView: "list" }, "");
    const handlePop = (e) => {
      const s = e.state || {};
      if (s.journalView === "detail" && s.journalId) {
        const t = tradesRef.current.find(x => x.id === s.journalId);
        if (t) {
          setSelected(t); setView("detail"); setFeedback(""); setEditTrade(false);
          restoreAnalysisFor(t, tradesRef.current);
          setDetailImgLoading(true);
          sbGetChartImg(t.id).then(img => setSelected(p => p?.id === t.id ? { ...p, chartImg: img } : p)).finally(() => setDetailImgLoading(false));
        }
      } else {
        if (selectedRef.current) scrollTargetRef.current = `trade-row-${selectedRef.current.id}`;
        setView("list"); setSelected(null); setEditTrade(false); setFeedback(""); setDetailAiAnalysis(""); setSimilarTrades([]);
      }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => { tradesRef.current = trades; }, [trades]);

  const recentStocks = [...new Set(trades.map(t => t.stock).filter(Boolean))].slice(0, 10);

  const sortTrades = (arr) => {
    const s = [...arr];
    switch (sortBy) {
      case "date_asc":     return s.sort((a,b) => (a.date||"").localeCompare(b.date||"") || a.id - b.id);
      case "pnlRate_desc": return s.sort((a,b) => (parseFloat(b.pnlRate)||0) - (parseFloat(a.pnlRate)||0));
      case "pnlRate_asc":  return s.sort((a,b) => (parseFloat(a.pnlRate)||0) - (parseFloat(b.pnlRate)||0));
      case "pnl_desc":     return s.sort((a,b) => (parseFloat(b.pnl)||0) - (parseFloat(a.pnl)||0));
      case "pnl_asc":      return s.sort((a,b) => (parseFloat(a.pnl)||0) - (parseFloat(b.pnl)||0));
      default:             return s.sort((a,b) => (b.date||"").localeCompare(a.date||"") || b.id - a.id);
    }
  };
  const applyTechFilter = (arr) => techFilter.size === 0 ? arr : arr.filter(t => techFilter.has(t.technique));

  const processImage = async (file, mode) => {
    setImgLoading(true); setFeedback("");
    try {
      const b64 = await compressImage(file);
      const mediaType = "image/jpeg";
      if (mode === "0606") {
        setChartImg(b64);
        const raw = await claude("JSON만 출력.", [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: `키움 [0606] 자동일지차트에서 종목명만 추출. 컴팩트 JSON(줄바꿈 없이)으로 출력:\n{"stock":"종목명"}\n확인불가는 null.` }
        ], 500);
        const p = await parseJSON(raw);
        setForm(f => ({ ...f, stock: p.stock || "" }));
        setFeedback("✅ 차트 정보 추출 완료");
      } else {
        const raw = await claude("JSON만 출력.", [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: `키움 [0328] 매매일지에서 JSON 추출. 먼저 테이블에 보이는 데이터 행의 총 개수를 정확히 세어라. trades 배열의 길이는 그 개수와 반드시 일치해야 한다. 동일 종목이 여러 행에 걸쳐 있고 값이 비슷하거나 같아도 절대 합치거나 생략하지 말고 행마다 개별 객체로 모두 포함. 종목명이 첫 행에만 표시되고 이후 행이 비어있는 경우(셀 병합) 위 행과 동일한 종목명으로 채워서 출력. 컴팩트 JSON(줄바꿈 없이)으로 출력:\n{"rowCount":보이는행개수,"date":"YYYY-MM-DD 또는 null","trades":[{"date":"YYYY-MM-DD 또는 null","stock":"종목명","buyPrice":매수가,"sellPrice":매도가,"pnl":실현손익,"pnlRate":수익률,"buyAmount":매입금액}]}` }
        ], 4096, 0);
        const p = await parseJSON(raw);
        const tradeList = fillMergedStockCells(Array.isArray(p) ? p : (p.trades || []));
        const extractedDate = (!Array.isArray(p) && p.date && p.date !== "null") ? p.date : "";
        const rowCountWarn = (!Array.isArray(p) && p.rowCount && p.rowCount !== tradeList.length) ? ` ⚠️ 행 개수 불일치(이미지 ${p.rowCount}행 vs 추출 ${tradeList.length}행) - 다시 시도해보세요` : "";
        if (tradeList.length > 0) {
          // 날짜 보정: 행별 date 없으면 상위 date 사용
          const filled = tradeList.map(f => ({
            ...f,
            date: (f.date && f.date !== "null") ? f.date : (extractedDate || null),
          }));
          // 종목+날짜 기준으로 그룹화 후 merge0397Rows(수정 탭과 동일 로직) 적용
          const groups = [];
          filled.forEach(f => {
            const g = groups.find(g => matchStock(g[0].stock, f.stock) && g[0].date === f.date);
            if (g) g.push(f); else groups.push([f]);
          });
          const merged = groups.map(g => {
            const m = merge0397Rows(g);
            return {
              stock: m.stock || "",
              date: m.date || "",
              buyPrice: m.buyPrice ?? "",
              sellPrice: m.sellPrice ?? "",
              pnl: m.pnl ?? "",
              pnlRate: m.pnlRate ?? "",
              amount: m.buyAmount ?? "",
            };
          });
          setPending0397(merged);
          setBulk0397Date(extractedDate || new Date().toISOString().slice(0, 10));
          const mergeNote = merged.length < filled.length ? ` (${filled.length}행 → ${merged.length}종목 자동 머지)` : "";
          setFeedback(`✅ ${merged.length}개 종목 추출 완료${mergeNote}${rowCountWarn}`);
        } else {
          setFeedback("❌ 추출된 종목 없음");
        }
      }
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setImgLoading(false);
  };
  const handlePaste = async (e) => {
    if (inputMode !== "img0606" && inputMode !== "img0397") return;
    // 클립보드 데이터는 await 이전에 동기적으로 모두 수집해야 함
    const imageFiles = [];
    if (e.clipboardData?.items) {
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith("image/") || item.kind === "file") {
          const f = item.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
    }
    if (imageFiles.length === 0 && e.clipboardData?.files) {
      for (const f of Array.from(e.clipboardData.files)) imageFiles.push(f);
    }
    if (imageFiles.length === 0) return;
    e.preventDefault();
    if (inputMode === "img0606" && chartImg) {
      // 0606 차트 이미 추출됨 → 다음 붙여넣기는 0328 재무 데이터로 처리
      await fillFormFrom0397(imageFiles[0]);
    } else if (inputMode === "img0397" && expanded0397 !== null) {
      // 0328 목록에서 항목 펼쳐진 상태 → 0606 차트 첨부
      await attach0606ToPending(imageFiles[0], expanded0397);
    } else {
      const mode = inputMode === "img0606" ? "0606" : "0397";
      await processImage(imageFiles[0], mode);
    }
  };

  const handleImageExtract = async (e, type) => {
    const file = e.target.files[0]; if (!file) return;
    await processImage(file, type);
    e.target.value = "";
  };

  const handleAiAnalysis = async () => {
    if (!form.reason && !form.chartDesc) { setFeedback("❌ 매매 이유 또는 차트 설명 필요."); return; }
    setAiLoading(true); setFeedback("");
    try {
      const techSummary = techniques.map(t => `[${t.name}] 카테고리:${t.category} / 매수조건:${t.entry?.condition} / 트리거:${t.pattern?.trigger} / 태그:${t.tags?.join(",")}`).join("\n");
      const result = await claude("주식 매매 코치. 객관적이고 구체적으로 분석.",
        `[매매]\n종목:${form.stock} 날짜:${form.date}\n매수가:${form.buyPrice} 매도가:${form.sellPrice} 수익률:${form.pnlRate}%\n이유:${form.reason}\n차트:${form.chartDesc || "없음"}\n\n[강의록DB]\n${techSummary}\n\n분석:\n1.유사기법\n2.일치점\n3.불일치/아쉬운점\n4.종합의견`, 1500);
      setAiAnalysis(result);
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setAiLoading(false);
  };

  const handleSave = async () => {
    if (!form.stock || !form.date || !form.technique) { setFeedback("❌ 종목명, 날짜, 매매 카테고리는 필수."); return; }
    const trade = { ...form, id: Date.now(), createdAt: new Date().toLocaleDateString("ko-KR"), chartImg, aiAnalysis };
    try {
      await sbUpsert("trades", [tradeToRow(trade)]);
      setTrades(p => [trade, ...p]);
      setForm({ stock: "", date: "", buyPrice: "", sellPrice: "", amount: "", pnl: "", pnlRate: "", reason: "", technique: "", memo: "", chartDesc: "" });
      setChartImg(null); setAiAnalysis(""); setFeedback("✅ 저장됨"); setView("list");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleBulkSave0397 = async () => {
    if (!bulk0397Date) { setFeedback("❌ 날짜를 선택해주세요."); return; }
    if (pending0397.length === 0) return;
    setFeedback("");
    const base = Date.now();
    try {
      const newTrades = pending0397.map((t, i) => ({
        ...t, date: t.date || bulk0397Date, id: base + i,
        createdAt: new Date().toLocaleDateString("ko-KR"),
        chartImg: t.chartImg || null, aiAnalysis: "", reason: "", technique: "", memo: "", chartDesc: t.chartDesc || "",
      }));
      await sbUpsert("trades", newTrades.map(tradeToRow));
      setTrades(p => [...[...newTrades].reverse(), ...p]);
      setPending0397([]);
      setFeedback(`✅ ${newTrades.length}개 저장됨`);
      setView("list");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  // 키움 0328 표는 동일 종목 연속 행에서 종목명 셀이 병합되어 비어있을 수 있음 → 위 행의 종목명으로 보정
  const fillMergedStockCells = (rows) => {
    let last = "";
    return rows.map(t => {
      const stock = (t.stock && t.stock !== "null") ? t.stock : last;
      last = stock || last;
      return { ...t, stock };
    });
  };

  const extract0397Trades = async (file) => {
    const b64 = await compressImageForOCR(file);
    const raw = await claude("JSON만 출력.", [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
      { type: "text", text: `키움 [0328] 매매일지 테이블에서 JSON 추출.\n\n[중요] 종목명은 한국 주식 종목명이다. 픽셀을 정밀하게 읽어 한 글자씩 정확히 인식할 것. 비슷하게 생긴 한글 자모를 혼동하지 말 것(예: ㅎ↔ㄹ, ㅇ↔ㅁ, 흥↔홀, 아↔마 등). 의심스러우면 여러 번 확인 후 가장 그럴듯한 한국 주식 종목명으로 출력.\n\n먼저 테이블에 보이는 데이터 행의 총 개수를 정확히 세어라. trades 배열의 길이는 그 개수와 반드시 일치해야 한다. 동일 종목이 여러 행에 걸쳐 있고 값이 비슷하거나 같아도 절대 합치거나 생략하지 말고 행마다 개별 객체로 모두 포함. 종목명이 첫 행에만 표시되고 이후 행이 비어있는 경우(셀 병합) 위 행과 동일한 종목명으로 채워서 출력. 컴팩트 JSON(줄바꿈 없이)으로 출력:\n{"rowCount":보이는행개수,"date":"YYYY-MM-DD 또는 null","trades":[{"date":"YYYY-MM-DD 또는 null","stock":"종목명","buyPrice":매수가,"sellPrice":매도가,"pnl":실현손익,"pnlRate":수익률,"buyAmount":매입금액}]}` }
    ], 4096, 0);
    const p = await parseJSON(raw);
    const trades = fillMergedStockCells(Array.isArray(p) ? p : (p.trades || []));
    const rowCount = !Array.isArray(p) ? p.rowCount : undefined;
    return { trades, rowCount };
  };

  const matchStock = (a, b) => {
    if (!a || !b) return false;
    const n = s => s.replace(/\s+/g, "").replace(/^\*/, "").toLowerCase();
    const isPref = s => /우[A-Z]?$/.test(s.replace(/\s+/g, ""));
    // 우선주는 이름이 정확히 일치할 때만 매칭
    if (isPref(a) || isPref(b)) return n(a) === n(b);
    return n(a) === n(b) || n(a).includes(n(b)) || n(b).includes(n(a));
  };

  const merge0397Rows = (rows) => {
    if (!rows || rows.length === 0) return null;
    if (rows.length === 1) return rows[0];
    const totalBuyAmt = rows.reduce((s, t) => s + (parseFloat(t.buyAmount) || 0), 0);
    const totalPnl    = rows.reduce((s, t) => s + (parseFloat(t.pnl)       || 0), 0);
    const wavg = (key) => totalBuyAmt > 0
      ? rows.reduce((s, t) => s + (parseFloat(t[key]) || 0) * (parseFloat(t.buyAmount) || 0), 0) / totalBuyAmt
      : rows.reduce((s, t) => s + (parseFloat(t[key]) || 0), 0) / rows.length;
    return {
      ...rows[0],
      buyPrice:  Math.round(wavg("buyPrice")),
      sellPrice: Math.round(wavg("sellPrice")),
      buyAmount: Math.round(totalBuyAmt),
      pnl:       Math.round(totalPnl),
      pnlRate:   totalBuyAmt > 0
        ? parseFloat((totalPnl / totalBuyAmt * 100).toFixed(2))
        : parseFloat((rows.reduce((s,t) => s + (parseFloat(t.pnlRate)||0), 0) / rows.length).toFixed(2)),
    };
  };

  const calcSimilarTrades = (trade, allTrades) => {
    const src = `${trade.reason || ""} ${trade.memo || ""}`.trim();
    if (!src) return [];
    const tokens = [...new Set(src.split(/[\s,./!?()\[\]「」『』【】]+/).filter(w => w.length >= 2))];
    return allTrades
      .filter(t => t.id !== trade.id && !t.deletedAt && (t.reason || t.memo))
      .map(t => {
        const txt = `${t.reason || ""} ${t.memo || ""}`;
        const score = tokens.reduce((s, w) => s + (txt.includes(w) ? 1 : 0), 0);
        return { t, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || (b.t.date || "").localeCompare(a.t.date || ""))
      .slice(0, 8)
      .map(({ t }) => t);
  };

  const attach0606ToPending = async (file, idx) => {
    setFill0397Loading(true); setFeedback("");
    try {
      const b64 = await compressImage(file);
      const raw = await claude("JSON만 출력.", [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: `키움 [0606] 자동일지차트에서 종목명만 추출. 컴팩트 JSON(줄바꿈 없이)으로 출력:\n{"stock":"종목명"}\n확인불가는 null.` }
      ], 500);
      const p = await parseJSON(raw);
      setPending0397(prev => prev.map((r, j) => j !== idx ? r : {
        ...r, chartImg: b64,
      }));
      setFeedback("✅ 차트 첨부됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setFill0397Loading(false);
  };

  const fillFormFrom0397 = async (file) => {
    setFill0397Loading(true); setFeedback("");
    try {
      const { trades, rowCount } = await extract0397Trades(file);
      const rowCountWarn = (rowCount && rowCount !== trades.length) ? ` ⚠️ 행 개수 불일치(이미지 ${rowCount}행 vs 추출 ${trades.length}행) - 다시 시도해보세요` : "";
      const matches = form.stock
        ? trades.filter(t => matchStock(t.stock, form.stock))
        : trades.slice(0, 1);
      const match = merge0397Rows(matches);
      if (match) {
        setForm(f => ({
          ...f,
          buyPrice: match.buyPrice ?? f.buyPrice,
          sellPrice: match.sellPrice ?? f.sellPrice,
          pnl: match.pnl ?? f.pnl,
          pnlRate: match.pnlRate ?? f.pnlRate,
          amount: match.buyAmount ?? f.amount,
        }));
        setFeedback((matches.length > 1 ? `✅ ${matches.length}건 머지됨` : "✅ 재무 데이터 채워짐") + rowCountWarn);
      } else {
        setFeedback(`❌ '${form.stock}' 매칭 종목 없음 (추출: ${trades.map(t => t.stock).join(", ")})${rowCountWarn}`);
      }
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setFill0397Loading(false);
  };

  const fillPptFrom0397 = async (file) => {
    setFill0397Loading(true); setFeedback("");
    try {
      const { trades, rowCount } = await extract0397Trades(file);
      const rowCountWarn = (rowCount && rowCount !== trades.length) ? ` ⚠️ 행 개수 불일치(이미지 ${rowCount}행 vs 추출 ${trades.length}행) - 다시 시도해보세요` : "";
      let matched = 0;
      setPendingPpt(prev => prev.map(entry => {
        const m = merge0397Rows(trades.filter(t => matchStock(t.stock, entry.stock)));
        if (!m) return entry;
        matched++;
        return { ...entry, buyPrice: m.buyPrice ?? "", sellPrice: m.sellPrice ?? "", pnl: m.pnl ?? "", pnlRate: m.pnlRate ?? "", amount: m.buyAmount ?? "" };
      }));
      setFeedback(`✅ ${matched}개 매칭 완료 (전체 ${pendingPpt.length}건)${rowCountWarn}`);
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setFill0397Loading(false);
  };

  const fillPptFromXls = async (file) => {
    setFill0397Loading(true); setFeedback("");
    try {
      const trades = await parseXlsCsvToTrades(file);
      let matched = 0;
      setPendingPpt(prev => prev.map(entry => {
        // 날짜+종목명 우선 매칭, 없으면 종목명만 (같은 종목 여러 행은 머지)
        let rows = trades.filter(t => matchStock(t.stock, entry.stock) && t.date === entry.date);
        if (rows.length === 0) rows = trades.filter(t => matchStock(t.stock, entry.stock));
        const m = merge0397Rows(rows);
        if (!m) return entry;
        matched++;
        return { ...entry, buyPrice: m.buyPrice || "", sellPrice: m.sellPrice || "", pnl: m.pnl || "", pnlRate: m.pnlRate || "", amount: m.buyAmount || "" };
      }));
      setFeedback(`✅ ${matched}개 매칭 완료`);
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setFill0397Loading(false);
  };

  const analyzeDetailTrade = async () => {
    if (!selected?.reason) { setFeedback("❌ 매매 이유를 먼저 입력하세요."); return; }
    setDetailAiLoading(true); setDetailAiAnalysis(""); setAiEditMode(false);
    try {
      // 1. 적용 기법과 관련된 강의록을 우선 선별하되, 나머지 강의록도 요약 형태로 함께 제공 (다른 강의록에 유사 내용이 있을 수 있음)
      const group = techGroupOf(selected.technique);
      const keywords = [...new Set([selected.technique, group, ...group.split("-")].filter(s => s && s.length >= 2))];
      const relatedTechs = techniques.filter(t => {
        const hay = `${t.name || ""} ${t.category || ""} ${(t.tags || []).join(" ")} ${t.rawInput || ""}`;
        return keywords.some(k => hay.includes(k));
      });
      const otherTechs = techniques.filter(t => !relatedTechs.includes(t));
      const techSummary = relatedTechs.map(t =>
        `[${t.name}] 카테고리:${t.category} / 타임프레임:${t.timeframe || "-"}\n` +
        `- 매수조건:${t.entry?.condition || "-"} / 포지션:${t.entry?.position || "-"} / 주의:${t.entry?.caution || "-"}\n` +
        `- 패턴(진입전→트리거→진입후): ${t.pattern?.before || "-"} → ${t.pattern?.trigger || "-"} → ${t.pattern?.after || "-"}\n` +
        `- 청산(수익/손실): ${t.exit?.profit || "-"} / ${t.exit?.loss || "-"}` +
        (t.rawInput ? `\n- 원문: ${t.rawInput.slice(0, 500)}` : '')
      ).join('\n\n');
      const otherTechSummary = otherTechs.map(t =>
        `[${t.name}] 카테고리:${t.category} / 매수조건:${t.entry?.condition || "-"} / 트리거:${t.pattern?.trigger || "-"} / 태그:${(t.tags || []).join(",") || "-"}`
      ).join('\n');
      const techNote = relatedTechs.length
        ? ""
        : `\n(주의: 이 매매의 기법(${selected.technique || "미지정"})과 직접 매칭되는 강의록을 찾지 못함. 기법 매칭이 안 된다는 점을 분석에 명시할 것.)`;

      // 1-1. 동일 날짜 + 동일 종목, 다른 기법으로 세분화된 매매 (있다면 기법별로 구분하여 분석)
      const siblingTrades = trades.filter(t => t.id !== selected.id && !t.deletedAt && t.date === selected.date && matchStock(t.stock, selected.stock));
      const siblingNote = siblingTrades.length
        ? `\n[같은 날(${selected.date}) 동일 종목(${selected.stock})의 다른 기법 매매 - 기법별로 세분화되어 기록됨]\n` +
          siblingTrades.map(t => `[기법:${t.technique || "-"}] 매수가:${t.buyPrice || "-"} 매도가:${t.sellPrice || "-"} 수익률:${t.pnlRate}%\n매매이유: ${t.reason?.slice(0, 150) || "-"}`).join('\n\n') +
          `\n위 매매들은 같은 종목을 진입/청산 구간별로 기법을 나누어 기록한 것이다. 이번 분석은 [현재 매매](기법:${selected.technique || "미지정"})의 매수가/매도가/매매이유에 해당하는 구간에만 집중하고, 다른 기법의 매매와 합쳐서 분석하거나 혼동하지 말 것. 각 기법은 별도로 분석할 것.\n`
        : "";

      // 2. 과거 유사 매매 (매매이유 워딩 참고용, 같은 날 다른 기법 매매는 제외)
      const pastTradesArr = trades.filter(t => t.id !== selected.id && !t.deletedAt && t.reason && !siblingTrades.some(s => s.id === t.id)).slice(0, 15);
      const pastTrades = pastTradesArr
        .map(t => `[ID:${t.id}] ${t.stock}(${t.date}, ${t.pnlRate}%, 기법:${t.technique || "-"}): ${t.reason?.slice(0, 100)}`).join('\n');

      // 3. 동일 날짜 실전매매 내용/차트 참고
      let liveSection = "(없음)";
      const liveImageBlocks = [];
      try {
        const liveRows = await sbGetLiveTrades();
        const liveMatches = liveRows.map(rowToLiveTrade).filter(t => t.date === selected.date);
        if (liveMatches.length) {
          liveSection = liveMatches.map(t => `[${t.stock}]${t.title ? ` ${t.title}` : ""}\n${(t.textContent || "").slice(0, 400)}`).join('\n---\n');
          const sameStock = liveMatches.filter(t => matchStock(t.stock, selected.stock));
          // 목록 조회는 이미지를 제외하므로, 매칭된 실전매매의 이미지는 개별 지연 로딩
          const imgTargets = sameStock.length ? sameStock : liveMatches;
          for (const t of imgTargets) {
            const imgs = await sbGetLiveImages(t.id);
            imgs.slice(0, 2).forEach(b64 => liveImageBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
          }
        }
      } catch {}

      // 4. 과거 분석 수정 피드백
      let correctionsCtx = "";
      const corrs = await sbGetCorrections();
      if (corrs.length > 0) {
        correctionsCtx = `[과거 분석 피드백 - 사용자가 직접 수정한 사례 (최근 ${corrs.length}건)]\n` +
          `아래는 AI가 잘못 분석한 내용을 사용자가 수정한 사례다. 비슷한 상황에서 동일한 실수를 반복하지 말 것:\n\n` +
          corrs.slice(0, 5).map((c, i) =>
            `[수정 사례 ${i + 1}]\n❌ 틀린 분석:\n${(c.original_text || "").slice(0, 400)}\n✅ 올바른 분석:\n${c.corrected_text.slice(0, 400)}`
          ).join('\n\n') + '\n\n';
      }

      // 5. 현재 매매 차트 + 첨부 이미지 안내
      const userContent = [];
      if (selected.chartImg) userContent.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: selected.chartImg } });
      userContent.push(...liveImageBlocks);
      const chartAxisNote = "\n- 차트 하단 가로축 라벨 해석: 글씨 굵기(볼드 여부)로 구분하지 말 것 - 이미지에서 굵기 구분은 신뢰할 수 없다. 대신 '/' 포함 여부로 구분: '/'가 있는 라벨(예: 05/21, 05/22)은 날짜이고, '/' 없이 숫자만 있는 라벨(예: 10, 11, 12, 13, 14)은 시간(시 단위)이다. 차트는 분봉 등 타임프레임 기준으로 그려지므로 '/' 없는 숫자는 항상 시간이며 '~일'(날짜)로 해석하면 안 된다." +
        (selected.technique === "투경해제" ? " 단, '투경해제' 기법은 일봉(daily) 차트를 쓰는 경우가 있으며, 이때는 가로축 라벨 전체가 연/월 단위(예: 2026/03, 04, 05)로 표시되므로 위 규칙이 아닌 연/월 단위로 해석할 것." : "");
      const chartMarkupNote = "\n- 차트는 반드시 좌→우 시간순으로 읽을 것. 왼쪽 캔들이 과거, 오른쪽 캔들이 현재/미래다. 차트 왼쪽에 있는 과거 고점·저점·급등락은 현재 매매의 직접 원인이 아닌 '사전 맥락'으로만 참고할 것." +
        "\n- 차트에 표시된 도형 해석: 파란/빨간 오각형(B/S 글자)은 사용자가 실제로 체결한 매수(B)/매도(S) 지점이다. B 마커가 차트 오른쪽에 있다면 왼쪽의 모든 캔들은 '매수 이전 역사'이며 그 구간의 가격 움직임을 현재 매매의 근거로 직접 연결하지 말 것. 분석의 기준점은 B 마커 위치이고, B 이전 차트는 진입 맥락 파악용으로만 활용할 것. '세력의 매수/매도 물량 출현' 같은 추측성 해석을 붙이지 말 것. 사각형(네모) 표시는 정답매매의 이상적 매수(진입) 타점, 동그라미(원/타원) 표시는 정답매매의 이상적 매도(청산) 타점이다. 차트에 네모·동그라미가 여러 개 있을 수 있으며, 개수에 상관없이 보이는 것을 빠짐없이 모두 확인하여 각각의 위치와 가격대를 파악할 것. 실제 매매(B/S 마커)와 정답매매(네모/동그라미)의 위치·가격을 하나씩 비교해 진입·청산 타이밍 차이를 분석에 활용하고, 도형이 보이지 않으면 언급하지 말 것." +
        "\n- 차트에 표시된 % 수치(예: -52.87%, +49.40% 등)는 키움 HTS가 자동 표시하는 '가격 변동폭 주석'이다. 위치와 무관하게 이 수치는 절대 현재 매매의 손익이 아니다. 실제 매매 손익은 오직 매수가·매도가(입력된 수치)와 B/S 마커 위치로만 판단할 것. B 마커 위치의 가격 ≈ 매수가, S 마커 위치의 가격 ≈ 매도가로 크로스체크하여 분석에 활용할 것." +
        "\n- '최고 OO,OOO', '최저 OO,OOO' 옆의 가격은 그 구간의 일중 고가/저가 자동주석일 뿐 매매가가 아니다. 또한 차트에 그어진 수평선(파란/회색 가로선, 커서선, 기준선)의 가격도 매매가나 상한가가 아니다 — 임의의 참조선이므로 그 값을 상한가·매수가·매도가로 지어내지 말 것. 이번 매매의 실제 매수가·매도가는 위 [현재 매매]에 입력된 값이 유일한 근거이며, 차트 주석·수평선 가격이 입력값과 다르거나 우연히 같아도 입력값을 기준으로 해석할 것." +
        "\n- [중요] '최고 OO,OOO (-40.54%, 13:21)'처럼 최고/최저 주석 옆의 %, 그리고 우측 상단의 HC/LC 값은 '그 고점(또는 저점)에서 차트 맨 오른쪽 현재가(가장 최근 캔들, 보통 당일)까지의 변동률'이다. 이 %는 여러 거래일에 걸친 누적 수치일 수 있다. 따라서 전일에 찍힌 고점의 -40%가 '전일 하루 동안 -40% 무너졌다'는 뜻이 절대 아니다(전일 종가까지의 하락 + 당일 하락이 합쳐진 값). 특정 하루(전일)의 봉 모양·양봉/음봉 여부·윗꼬리·마감 강도를 판단할 때는 이 누적 %를 쓰지 말고, 그 날짜 구간 안에서의 시가→종가→고가→저가 캔들 형태만 보고 판단할 것. 전일 캔들의 마감 강도는 전일 종가 위치로만 평가하고, 당일 하락분을 전일 봉에 합산하지 말 것." +
        "\n- 분석 대상일의 시가가 그 직전에 표시된 캔들들의 가격대보다 위/아래에서 시작했다면 갭상승/갭하락으로 언급 가능하나, 차트에 직접 보이지 않는 사실을 추정해서 단정하지 말 것." +
        "\n- 가로축에서 MM/DD 형식의 날짜 라벨이 두 개 이상 보이면 차트에 두 개 이상의 거래일이 함께 표시된 것이다. 이 경우 가장 오른쪽 날짜가 당일, 그 왼쪽 날짜가 전일(또는 그 이전)이다. 분석 시 전일 흐름과 당일 흐름을 구분하여 각각 언급할 것. 날짜 라벨이 하나뿐이면 단일 거래일 차트이므로 이 규칙은 무시할 것." +
        "\n- 차트 중간을 세로로 가로지르는 빨간(붉은) 수직선은 '날짜(거래일)가 바뀌는 경계'다. 이 선의 왼쪽은 전일(또는 그 이전) 장, 오른쪽은 당일 장이다. 가로축 날짜 라벨과 함께 이 수직선을 기준으로 전일/당일 구간을 구분할 것." +
        "\n- 캔들이 특정 가격대(가격제한폭 상단)에 도달한 뒤 그 가격에서 수평으로 일자로 머물러 있는 구간은 상한가(가격제한폭 도달)에 잠겨 있는 상태다. 특히 장 마감 시점까지 그 상단 가격에 수평으로 붙어 있으면 '상한가로 마감'한 것으로 해석할 것." +
        (selected.technique === "상따" ? "\n- [상따 기법 규칙] 전일 차트는 상한가로 마감한 것이다(가격제한폭 상단에 수평으로 붙어 마감한 형태). 상따는 정의상 '전일 상한가에서 매수'하는 기법이므로, 입력된 매수가 = 전일 상한가 진입가로 간주할 것. B 마커가 차트에 보이지 않아도 상한가 매수로 전제하고, 상한가 가격은 커서선/수평선이 아니라 입력된 매수가로 판단할 것. 차트에 '최저' 주석 가격이 매수가와 같거나 비슷하게 표시되더라도, 그것은 전일 상한가를 훼손하지 않은 일중 저점일 뿐이므로 입력 매수가를 '저점 선매수'나 '상따 원칙 위반'으로 재해석하지 말 것. 당일은 상한가 다음날로서 갭상승 또는 보합 출발하는 흐름을 중점 분석할 것. 당일 갭하락 출발인 경우는 '상따'가 아닌 '상한가하락시작' 기법에 해당하므로 혼동하지 말 것." : "") +
        (selected.technique?.startsWith("상한가하락시작") ? "\n- [상한가하락시작 기법 규칙] 전일 차트는 상한가로 마감한 것이다(가격제한폭 상단에 수평으로 붙어 마감한 형태로 확인 가능). 당일은 상한가 다음날이나 갭하락 또는 약세 출발하는 흐름이다. 전일 상한가 마감 후 당일 하락 출발 시점의 매매 맥락을 중점 분석할 것." : "");
      const imageNote = (selected.chartImg || liveImageBlocks.length)
        ? `[첨부 이미지]${selected.chartImg ? `\n- 이 매매의 차트 이미지 (캔들 모양, 진입/이탈 시간대 분석에 활용)${chartAxisNote}${chartMarkupNote}` : ""}${liveImageBlocks.length ? `\n- 동일 날짜 실전매매 관련 이미지 ${liveImageBlocks.length}장` : ""}\n이미지에서 실제로 확인 가능한 내용만 사용하고, 기법 설명과 무관하거나 불확실한 내용은 언급하지 말 것.`
        : `[첨부 이미지] 없음. 차트 기반 분석(봉 모양, 시간대 등)은 시도하지 말고 '차트 없음'으로만 명시할 것. 추측해서 지어내지 말 것.`;

      const dayIdx = dayOfWeek(selected.date);
      const dayLabel = dayIdx !== null ? `(${DAY_NAMES[dayIdx]})` : "";

      userContent.push({ type: "text", text:
        `[표기 규칙] 매매이유에서 괄호 안 숫자는 만원 단위임. 예: (+50)=+50만원 수익, (1000)=1000만원 매수금액, (-30)=-30만원 손실. "n만원"이라고 쓰지 않고 숫자만 씀.\n\n` +
        `[현재 매매] 종목:${selected.stock} 날짜:${selected.date}${dayLabel} 매수가:${selected.buyPrice || "-"} 매도가:${selected.sellPrice || "-"} 수익률:${selected.pnlRate}% 적용기법:${selected.technique || "미지정"}\n` +
        `매매이유: ${selected.reason}\n${selected.memo ? `메모: ${selected.memo}\n` : ""}${siblingNote}\n` +
        `${imageNote}\n\n` +
        `[적용 기법 강의록 - 우선 참고]\n${techSummary || "(직접 매칭되는 강의록 없음)"}${techNote}\n\n` +
        `[기타 강의록 목록 - 위 기법에 없어도 이번 매매와 유사한 내용이 있는지 추가로 확인]\n${otherTechSummary || "(없음)"}\n\n` +
        `[동일 날짜(${selected.date}) 실전매매 기록]\n${liveSection}\n\n` +
        `[과거 유사 매매 - 매매이유 원문]\n${pastTrades || "(없음)"}\n\n` +
        correctionsCtx +
        `아래 항목을 분석:\n` +
        `1. 기법 매칭: 매수가/매도가/수익률을 참고하여 이번 매매가 [적용 기법 강의록]의 진입조건/포지션/주의사항에 얼마나 부합하는지 (강의록 근거를 인용). [기타 강의록 목록]에 이번 매매와 더 유사한 내용이 있다면 함께 언급\n` +
        `2. 차트 분석: 첨부된 차트가 있다면 봉의 모양과 진입/이탈 시간대가 기법의 트리거·패턴 설명과 일치하는지 확인. 차트가 없거나 기법과 무관한 내용은 생략\n` +
        `3. 정답매매: 강의록 기법 기준 이상적 진입/손절/익절 시나리오 (실제 매매 아님). 금액은 같은 표기 규칙으로 괄호 안 숫자(만원) 표기, 퍼센트 금지\n` +
        `4. 잘된 점 / 개선할 점 (기법 부합도 중심)\n` +
        `5. 동일 날짜 실전매매와의 연관성 (시장 상황 등 참고할 점이 있다면)\n` +
        `6. 과거 유사 매매 비교: 매매이유에 등장한 워딩(표현)이 이번 매매와 얼마나 비슷한지\n\n` +
        `※ 응답 맨 마지막 줄에 과거 유사 매매 중 가장 유사한 것 최대 5개의 ID를 아래 형식으로만 출력(다른 텍스트 없이): SIMILAR:[id1,id2,...]`
      });

      const result = await claude("주식 매매 분석 전문가. 핵심만 간결하게. 분석은 반드시 [적용 기법 강의록] 내용에 근거하고, 강의록에 없는 내용을 일반론으로 단정하지 않는다. 차트 이미지가 없으면 차트 관련 내용을 지어내지 않는다. 차트에서 보이는 내용이 기법 설명과 무관하면 무시한다. [중요] '정답매매'는 사용자가 실제 실행한 매매가 아닌, 해당 기법 기준으로 올바르게 했어야 할 이상적 시나리오다. 절대 실제 매매 내용을 정답매매로 제시하지 않는다.",
        userContent, 8000, undefined, "claude-fable-5");
      // 응답 끝에서 SIMILAR:[...] 추출
      const simMatch = result.match(/SIMILAR:\[([\d,\s]*)\]/);
      const analysisText = result.replace(/\n?SIMILAR:\[[\d,\s]*\]\s*$/, '').trim();
      setDetailAiAnalysis(analysisText);
      let sims;
      if (simMatch) {
        const ids = simMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        sims = pastTradesArr.filter(t => ids.includes(t.id));
      } else {
        sims = calcSimilarTrades(selected, trades);
      }
      setSimilarTrades(sims);
      analysisCacheRef.current[selected.id] = { text: analysisText, similarIds: sims.map(t => t.id) };
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setDetailAiLoading(false);
  };

  const handleCorrection = async () => {
    const original = detailAiAnalysis || selected?.aiAnalysis || "";
    const corrected = aiEditText.trim();
    setAiEditMode(false);
    if (corrected && corrected !== original) {
      try { await sbAddCorrection(original, corrected); } catch {}
      setDetailAiAnalysis(corrected);
      if (analysisCacheRef.current[selected?.id]) {
        analysisCacheRef.current[selected.id] = { ...analysisCacheRef.current[selected.id], text: corrected };
      }
    }
    await analyzeDetailTrade();
  };

  const processPptFile = async (file) => {
    setPptLoading(true); setPptProgress(""); setFeedback("");
    try {
      const slides = await parsePptxToSlides(file);
      const results = [];
      for (let i = 0; i < slides.length; i++) {
        setPptProgress(`⏳ ${i + 1} / ${slides.length} 슬라이드 처리 중...`);
        const { texts, images } = slides[i];
        if (!texts && images.length === 0) continue;
        // Compress images
        const compressed = [];
        for (const img of images) {
          try { compressed.push(await compressImage(b64ToFile(img.b64, img.mime))); }
          catch { /* 렌더링 불가 이미지 무시 */ }
        }
        const content = [
          ...compressed.map(b64 => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })),
          { type: "text", text: `슬라이드 텍스트:\n${texts || "(없음)"}\n\n이미지 중 키움증권 주식 차트(분봉/일봉)를 찾아 컴팩트 JSON(줄바꿈 없이)으로 추출:\n{"chart_index":이미지번호(0부터,없으면null),"stock":"종목명","date":"YYYY-MM-DD","reason":"매매이유(불릿 포함 그대로)"}` }
        ];
        try {
          const raw = await claude("JSON만 출력.", content, 2000);
          const p = await parseJSON(raw);
          const chartImg = (p.chart_index != null && compressed[p.chart_index]) ? compressed[p.chart_index] : null;
          if (!p.stock && !p.reason && !chartImg) continue; // 차트·텍스트 둘 다 인식 못하면 삭제
          results.push({
            stock: p.stock || "", date: p.date || new Date().toISOString().slice(0, 10),
            reason: p.reason || "", chartImg,
            buyPrice: "", sellPrice: "", amount: "", pnl: "", pnlRate: "", technique: "", memo: "",
          });
        } catch { /* 슬라이드 파싱 실패 시 스킵 */ }
      }
      if (results.length > 0) { setPendingPpt(results); setFeedback(`✅ ${results.length}개 슬라이드 추출 완료`); }
      else setFeedback("❌ 추출된 슬라이드 없음");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setPptLoading(false); setPptProgress("");
  };

  const handleBulkSavePpt = async () => {
    if (pendingPpt.length === 0) return;
    setFeedback("");
    const base = Date.now();
    try {
      const newTrades = pendingPpt.map((t, i) => ({
        ...t, id: base + i, createdAt: new Date().toLocaleDateString("ko-KR"),
        aiAnalysis: "", chartDesc: "",
      }));
      await sbUpsert("trades", newTrades.map(tradeToRow));
      setTrades(p => [...[...newTrades].reverse(), ...p]);
      setPendingPpt([]);
      setFeedback(`✅ ${newTrades.length}건 저장됨`);
      setListTab("trades"); setView("list");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleEditImageExtract = async (file) => {
    setEditImgLoading(true); setFeedback("");
    try {
      const b64 = await compressImage(file);
      const raw = await claude("JSON만 출력.", [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: `키움 [0606] 자동일지차트에서 종목명만 추출. 컴팩트 JSON(줄바꿈 없이)으로 출력:\n{"stock":"종목명"}\n확인불가는 null.` }
      ], 500);
      const p = await parseJSON(raw);
      setEditForm(f => ({
        ...f, chartImg: b64,
        ...(p.stock && { stock: p.stock }),
      }));
      setFeedback("✅ 차트 정보 추출 완료");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setEditImgLoading(false);
  };

  const autoMergeByStock = (rows) => {
    const groups = [];
    rows.forEach(r => {
      const g = groups.find(g => matchStock(g[0].stock, r.stock) && g[0].date === r.date);
      if (g) g.push(r); else groups.push([r]);
    });
    return groups.map(g => {
      if (g.length === 1) return g[0];
      const totalAmt = g.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
      const totalPnl = g.reduce((s, r) => s + (parseFloat(r.pnl) || 0), 0);
      const wavg = (key) => totalAmt > 0
        ? g.reduce((s, r) => s + (parseFloat(r[key]) || 0) * (parseFloat(r.amount) || 0), 0) / totalAmt
        : g.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0) / g.length;
      return {
        ...g[0],
        buyPrice: Math.round(wavg("buyPrice")),
        sellPrice: Math.round(wavg("sellPrice")),
        pnl: Math.round(totalPnl),
        pnlRate: totalAmt > 0
          ? parseFloat((totalPnl / totalAmt * 100).toFixed(2))
          : parseFloat((g.reduce((s, r) => s + (parseFloat(r.pnlRate) || 0), 0) / g.length).toFixed(2)),
        amount: Math.round(totalAmt),
      };
    });
  };

  const mergePending = () => {
    if (sel0397.size < 2) return;
    const idxs = [...sel0397].sort((a, b) => a - b);
    const rows = idxs.map(i => pending0397[i]);
    const totalAmt = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const totalPnl = rows.reduce((s, r) => s + (parseFloat(r.pnl) || 0), 0);
    const merged = {
      stock: rows[0].stock,
      buyPrice: Math.round(rows.reduce((s, r) => s + (parseFloat(r.buyPrice) || 0), 0) / rows.length),
      sellPrice: Math.round(rows.reduce((s, r) => s + (parseFloat(r.sellPrice) || 0), 0) / rows.length),
      pnl: Math.round(totalPnl),
      pnlRate: parseFloat(totalAmt > 0 ? ((totalPnl / totalAmt) * 100).toFixed(2) : 0),
      amount: Math.round(totalAmt),
    };
    const next = [];
    let inserted = false;
    pending0397.forEach((r, i) => {
      if (i === idxs[0] && !inserted) { next.push(merged); inserted = true; }
      if (!sel0397.has(i)) next.push(r);
    });
    if (!inserted) next.push(merged);
    setPending0397(next);
    setSel0397(new Set());
  };

  const handleEditSave = async () => {
    if (!editForm.stock) { setFeedback("❌ 종목명은 필수."); return; }
    try {
      await sbUpsert("trades", [tradeToRow(editForm)]);
      setTrades(p => p.map(t => t.id === editForm.id ? editForm : t));
      setSelected(editForm); setEditTrade(false); setFeedback("✅ 수정됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleSoftDelete = async (id) => {
    try {
      await sbPatch(id, { deleted_at: new Date().toISOString() });
      setTrades(p => p.filter(t => t.id !== id));
      setSelected(null); setDeleteConfirmId(null); setView("list"); setFeedback("🗑️ 휴지통으로 이동됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const loadTrash = async () => {
    setTrashLoading(true);
    try {
      // 10일 지난 항목 자동 영구삭제
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      await sbDeleteOld(tenDaysAgo).catch(() => {});
      const rows = await sbGetTrash();
      setTrashTrades(rows.map(rowToTrade));
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setTrashLoading(false);
  };

  const handleRestore = async (id) => {
    try {
      await sbPatch(id, { deleted_at: null });
      setTrashTrades(p => p.filter(t => t.id !== id));
      await load();
      setFeedback("✅ 복원됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleBulkSoftDelete = async () => {
    if (selectedIds.size === 0) return;
    const now = new Date().toISOString();
    try {
      await Promise.all([...selectedIds].map(id => sbPatch(id, { deleted_at: now })));
      setTrades(p => p.filter(t => !selectedIds.has(t.id)));
      setFeedback(`🗑️ ${selectedIds.size}개 휴지통으로 이동됨`);
      setSelectedIds(new Set()); setSelectMode(false);
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handlePermDelete = async (id) => {
    try {
      await sbDelete("trades", id);
      setTrashTrades(p => p.filter(t => t.id !== id));
      setFeedback("✅ 영구 삭제됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleBulkTrashRestore = async () => {
    if (trashSelectedIds.size === 0) return;
    try {
      await Promise.all([...trashSelectedIds].map(id => sbPatch(id, { deleted_at: null })));
      setTrashTrades(p => p.filter(t => !trashSelectedIds.has(t.id)));
      await load();
      setFeedback(`✅ ${trashSelectedIds.size}개 복원됨`);
      setTrashSelectedIds(new Set()); setTrashSelectMode(false);
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleBulkPermDelete = async () => {
    if (trashSelectedIds.size === 0) return;
    try {
      await Promise.all([...trashSelectedIds].map(id => sbDelete("trades", id)));
      setTrashTrades(p => p.filter(t => !trashSelectedIds.has(t.id)));
      setFeedback(`✅ ${trashSelectedIds.size}개 영구삭제됨`);
      setTrashSelectedIds(new Set()); setTrashSelectMode(false);
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleDuplicate = async () => {
    const dup = { ...selected, id: Date.now(), createdAt: new Date().toLocaleDateString("ko-KR"), deletedAt: null };
    try {
      await sbUpsert("trades", [tradeToRow(dup)]);
      setTrades(p => [dup, ...p]);
      setSelected(dup); setEditForm({ ...dup }); setEditTrade(true); setView("detail");
      setFeedback("✅ 복제됨"); setDeleteConfirmId(null);
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const inp = (field, placeholder, type = "text") => {
    const comma = type === "numcomma";
    return (
      <input
        type={comma ? "text" : type}
        inputMode={comma ? "numeric" : undefined}
        value={comma ? fmtNum(form[field]) : (form[field] ?? "")}
        onChange={e => {
          const val = comma ? e.target.value.replace(/,/g, "") : e.target.value;
          setForm(p => autoCalc(p, field, val));
        }}
        placeholder={placeholder}
        style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box", textAlign: "left" }}
      />
    );
  };

  return (
    <div>
      <div style={{ position: "sticky", top: isMobile ? 76 : 45, zIndex: 90, background: "#0f1117", paddingTop: 8, paddingBottom: 8, marginBottom: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {[
          ["trades", `📋 매매 (${trades.length})`],
          ["trash", `🗑️ 휴지통${trashTrades.length > 0 ? ` (${trashTrades.length})` : ""}`],
        ].map(([tab, label]) => (
          <button key={tab} onClick={() => {
            setView("list"); setListTab(tab); setSelected(null); setFeedback(""); setAiAnalysis("");
            setSelectMode(false); setSelectedIds(new Set());
            setTrashSelectMode(false); setTrashSelectedIds(new Set());
            if (tab === "trash") loadTrash();
          }}
            style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, background: view === "list" && !selected && listTab === tab ? (tab === "trash" ? "#7f8c8d" : "#4f8ef7") : "#2a2d3a", color: view === "list" && !selected && listTab === tab ? "#fff" : "#aaa" }}>{label}</button>
        ))}
        <button onClick={() => { setView("add"); setSelected(null); setFeedback(""); setAiAnalysis(""); setSelectMode(false); setSelectedIds(new Set()); }}
          style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, background: view === "add" ? "#4f8ef7" : "#2a2d3a", color: view === "add" ? "#fff" : "#aaa" }}>매매 추가</button>
        {view === "list" && !selected && (
          <button onClick={() => {
            if (listTab === "trash") { setTrashSelectMode(p => !p); setTrashSelectedIds(new Set()); }
            else { setSelectMode(p => !p); setSelectedIds(new Set()); }
          }}
            style={{ padding: "4px 10px", background: (listTab === "trash" ? trashSelectMode : selectMode) ? "#e74c3c" : "#2a2d3a", border: "none", color: (listTab === "trash" ? trashSelectMode : selectMode) ? "#fff" : "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
            {(listTab === "trash" ? trashSelectMode : selectMode) ? "선택 취소" : "☑️ 선택"}
          </button>
        )}
        <button onClick={() => setGroupByDate(p => !p)}
          style={{ padding: "4px 10px", background: groupByDate ? "#4f8ef7" : "#2a2d3a", border: "none", color: groupByDate ? "#fff" : "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>📅 날짜별</button>
        {view === "list" && !selected && listTab !== "trash" && (
          <input type="date" onChange={e => {
            const v = e.target.value;
            if (!v) return;
            setGroupByDate(true);
            setScrollToDate(v);
            e.target.value = "";
          }}
            style={{ background: "#2a2d3a", border: "none", borderRadius: 5, color: "#aaa", padding: "4px 8px", fontSize: 12, colorScheme: "dark", cursor: "pointer" }}
            title="날짜로 이동" />
        )}
        {view === "list" && !selected && listTab !== "trash" && (() => {
          const allTechs = [...new Set(trades.filter(t => t.technique).map(t => t.technique))].sort();
          return (
            <>
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowTechDrop(p => !p)}
                  style={{ padding: "4px 10px", background: techFilter.size > 0 ? "#4f8ef7" : "#2a2d3a", border: "none", color: techFilter.size > 0 ? "#fff" : "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
                  🏷 기법{techFilter.size > 0 ? ` (${techFilter.size})` : ""}
                </button>
                {showTechDrop && (
                  <>
                    <div onClick={() => setShowTechDrop(false)} style={{ position: "fixed", inset: 0, zIndex: 199 }} />
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200, background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: 8, padding: "8px 4px", minWidth: 160, boxShadow: "0 4px 20px #0009" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px 6px", borderBottom: "1px solid #2a2d3a", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: "#888" }}>기법 필터</span>
                        <button onClick={() => setTechFilter(new Set())} style={{ fontSize: 10, background: "none", border: "none", color: "#4f8ef7", cursor: "pointer", padding: 0 }}>전체 해제</button>
                      </div>
                      {allTechs.length === 0
                        ? <div style={{ fontSize: 11, color: "#555", padding: "4px 8px" }}>기법 없음</div>
                        : allTechs.map(tech => (
                          <label key={tech} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12, color: "#ddd", borderRadius: 4 }}
                            onMouseEnter={e => e.currentTarget.style.background = "#2a2d3a"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <input type="checkbox" checked={techFilter.has(tech)}
                              onChange={() => setTechFilter(prev => { const n = new Set(prev); n.has(tech) ? n.delete(tech) : n.add(tech); return n; })}
                              style={{ accentColor: "#4f8ef7", cursor: "pointer" }} />
                            {tech}
                          </label>
                        ))
                      }
                    </div>
                  </>
                )}
              </div>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                style={{ background: "#2a2d3a", border: "1px solid #3a3d4a", color: "#aaa", borderRadius: 5, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}>
                <option value="date_desc">최근 날짜순 ↓</option>
                <option value="date_asc">오래된 날짜순 ↑</option>
                <option value="pnlRate_desc">수익률 높은순 ↓</option>
                <option value="pnlRate_asc">수익률 낮은순 ↑</option>
                <option value="pnl_desc">수익금 높은순 ↓</option>
                <option value="pnl_asc">수익금 낮은순 ↑</option>
              </select>
            </>
          );
        })()}
        <button onClick={load} style={{ marginLeft: "auto", padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>🔄</button>
      </div>

      {loading && <div style={{ color: "#555", padding: 40, textAlign: "center" }}>로딩 중...</div>}

      {!loading && view === "add" && (
        <div onPaste={handlePaste}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["img0606","📈 [0606]"], ["img0397","📋 [0328]"], ["ppt","📊 PPT"], ["manual","✏️ 직접입력"]].map(([m, label]) => (
              <button key={m} onClick={() => { setInputMode(m); setPending0397([]); setPendingPpt([]); setFeedback(""); }}
                style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, background: inputMode === m ? "#4f8ef7" : "#2a2d3a", color: inputMode === m ? "#fff" : "#aaa" }}>{label}</button>
            ))}
          </div>

          {(inputMode === "img0606" || inputMode === "img0397") && (
            <div
              ref={pasteZoneRef}
              tabIndex={0}
              onClick={() => pasteZoneRef.current?.focus()}
              style={{ marginBottom: 14, outline: "none" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "#2a2d3a", border: "1px dashed #4f8ef7", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#aaa" }}>
                  📎 {inputMode === "img0606" ? "[0606] 차트 이미지" : "[0328] 매매내역 이미지"}
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleImageExtract(e, inputMode === "img0606" ? "0606" : "0397")} />
                </label>
                <span style={{ fontSize: 12, color: "#555" }}>또는 Ctrl+V 붙여넣기</span>
                {imgLoading && <span style={{ fontSize: 13, color: "#aaa" }}>⏳ 추출 중...</span>}
              </div>
            </div>
          )}

          {inputMode === "ppt" ? (
            <div>
              {pendingPpt.length === 0 ? (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", background: "#2a2d3a", border: "1px dashed #4f8ef7", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#aaa" }}>
                    📊 .pptx 파일 업로드
                    <input type="file" accept=".pptx" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) { processPptFile(f); e.target.value = ""; } }} />
                  </label>
                  {pptLoading && <div style={{ marginTop: 10, fontSize: 13, color: "#aaa" }}>{pptProgress}</div>}
                  {!pptLoading && feedback && <div style={{ marginTop: 8, fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</div>}
                </div>
              ) : (() => {
                const upd = (i, patch) => setPendingPpt(p => p.map((r, j) => j === i ? { ...r, ...patch } : r));
                return (
                  <div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#555", marginLeft: 4 }}>{feedback}</span>
                    </div>
                    <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                      {pendingPpt.map((t, i) => {
                        return (
                          <div key={i} style={{ ...box, border: "1px solid #2a2d3a", position: "relative" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                              <button onClick={() => setPendingPpt(p => p.filter((_, j) => j !== i))}
                                style={{ marginLeft: "auto", background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 13 }}>✕</button>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: t.chartImg ? "110px 1fr" : "1fr", gap: 10, marginBottom: 10 }}>
                              {t.chartImg && <img src={`data:image/jpeg;base64,${t.chartImg}`} alt="chart" style={{ width: "100%", borderRadius: 6, border: "1px solid #2a2d3a" }} />}
                              <div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
                                  <div><div style={label11}>종목명 *</div>
                                    <input value={t.stock} onChange={e => upd(i, { stock: e.target.value })}
                                      style={{ width:"100%", background:"#13151f", border:"1px solid #2a2d3a", borderRadius:6, color:"#e0e0e0", padding:"5px 7px", fontSize:12, boxSizing:"border-box" }} />
                                  </div>
                                  <div><div style={label11}>날짜</div>
                                    <input type="date" value={t.date} onChange={e => upd(i, { date: e.target.value })}
                                      style={{ width:"100%", background:"#13151f", border:"1px solid #2a2d3a", borderRadius:6, color:"#e0e0e0", padding:"5px 7px", fontSize:12, boxSizing:"border-box", colorScheme:"dark" }} />
                                  </div>
                                  <div><div style={label11}>카테고리</div>
                                    <select value={t.technique || ""} onChange={e => upd(i, { technique: e.target.value })}
                                      style={{ width:"100%", background:"#13151f", border:"1px solid #2a2d3a", borderRadius:6, color:"#e0e0e0", padding:"5px 7px", fontSize:12 }}>
                                      <option value="">없음</option>
                                      {TRADE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                </div>
                                <div style={label11}>매매 이유</div>
                                <textarea value={t.reason} onChange={e => upd(i, { reason: e.target.value })}
                                  style={{ width:"100%", minHeight:52, background:"#13151f", border:"1px solid #2a2d3a", borderRadius:6, color:"#e0e0e0", padding:7, fontSize:12, resize:"vertical", boxSizing:"border-box" }} />
                              </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 5 }}>
                              {[["buyPrice","매수가"],["sellPrice","매도가"],["pnlRate","수익률(%)"],["pnl","실현손익"],["amount","매입금액"]].map(([f, lbl]) => (
                                <div key={f}><div style={label11}>{lbl}</div>
                                  <input type="number" value={t[f]} onChange={e => upd(i, { [f]: e.target.value })} placeholder="-"
                                    style={{ width:"100%", background:"#13151f", border:"1px solid #2a2d3a", borderRadius:6, color:"#e0e0e0", padding:"5px 7px", fontSize:12, boxSizing:"border-box" }} />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "#2a2d3a", border: "1px solid #3a3d4a", borderRadius: 5, cursor: "pointer", fontSize: 12, color: "#aaa" }}>
                        📋 0328 이미지 매칭
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => { const f = e.target.files[0]; if (f) { await fillPptFrom0397(f); e.target.value = ""; } }} />
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "#2a2d3a", border: "1px solid #3a3d4a", borderRadius: 5, cursor: "pointer", fontSize: 12, color: "#aaa" }}>
                        📊 XLS/CSV 매칭
                        <input type="file" accept=".xls,.xlsx,.csv" style={{ display: "none" }} onChange={async e => { const f = e.target.files[0]; if (f) { await fillPptFromXls(f); e.target.value = ""; } }} />
                      </label>
                      {fill0397Loading && <span style={{ fontSize: 12, color: "#aaa" }}>⏳</span>}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <button onClick={handleBulkSavePpt} style={{ padding: "8px 20px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>실제매매 저장</button>
                      <button onClick={() => { setPendingPpt([]); setFeedback(""); }} style={{ padding: "8px 14px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>취소</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : inputMode === "img0397" ? (
            pending0397.length > 0 ? (
              <div style={{ ...box, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>추출된 매매 ({pending0397.length}건)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: "#888" }}>날짜</span>
                  <input type="date" value={bulk0397Date} onChange={e => setBulk0397Date(e.target.value)}
                    style={{ background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "6px 10px", fontSize: 13, colorScheme: "dark" }} />
                </div>
                <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                  {pending0397.map((t, i) => {
                    const isOpen = expanded0397 === i;
                    return (
                      <div key={i} style={{ background: "#13151f", borderRadius: 6, overflow: "hidden", border: `1px solid ${isOpen ? "#4f8ef7" : "transparent"}` }}>
                        <div onClick={() => setExpanded0397(p => p === i ? null : i)}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", fontSize: 12, cursor: "pointer" }}>
                          {t.chartImg && <span style={{ fontSize: 10, color: "#4f8ef7" }}>🖼️</span>}
                          <span style={{ fontWeight: 600, minWidth: 80, color: "#ddd" }}>{t.stock}</span>
                          {t.date && <span style={{ fontSize: 11, color: "#555" }}>{t.date}</span>}
                          <span style={{ color: "#777" }}>매수 {t.buyPrice}</span>
                          <span style={{ color: "#777" }}>매도 {t.sellPrice}</span>
                          <span style={{ marginLeft: "auto", fontWeight: 700, color: pnlColor(parseFloat(t.pnlRate)) }}>
                            {parseFloat(t.pnlRate) > 0 ? "+" : ""}{t.pnlRate}%
                          </span>
                          <button onClick={e => { e.stopPropagation(); setPending0397(p => p.filter((_, j) => j !== i)); if (expanded0397 === i) setExpanded0397(null); }}
                            style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>✕</button>
                        </div>
                        {isOpen && (
                          <div style={{ borderTop: "1px solid #2a2d3a", padding: "10px 10px 10px" }}>
                            {t.chartImg && <img src={`data:image/jpeg;base64,${t.chartImg}`} alt="chart" style={{ width: "100%", maxHeight: 160, objectFit: "contain", borderRadius: 6, marginBottom: 8, background: "#0f1117" }} />}
                            <div
                              tabIndex={0}
                              onClick={e => e.currentTarget.focus()}
                              onPaste={async e => {
                                const files = [];
                                if (e.clipboardData?.items) for (const item of Array.from(e.clipboardData.items)) { if (item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) files.push(f); } }
                                if (!files.length) return;
                                e.preventDefault();
                                await attach0606ToPending(files[0], i);
                              }}
                              style={{ padding: "6px 12px", background: "#2a2d3a", border: "1px dashed #4f8ef7", borderRadius: 6, cursor: "text", fontSize: 12, color: "#aaa", outline: "none", display: "flex", alignItems: "center", gap: 8 }}
                            >
                              🖼️ 0606 차트 Ctrl+V
                              <label style={{ marginLeft: 4, color: "#4f8ef7", cursor: "pointer", fontSize: 11 }} onClick={e => e.stopPropagation()}>
                                파일선택
                                <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => { const f = e.target.files[0]; if (f) { await attach0606ToPending(f, i); e.target.value = ""; } }} />
                              </label>
                            </div>
                            {fill0397Loading && <span style={{ fontSize: 11, color: "#aaa", marginTop: 4, display: "block" }}>⏳ 추출 중...</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={handleBulkSave0397} style={{ padding: "8px 20px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>전체 저장</button>
                  <button onClick={() => setPending0397([])} style={{ padding: "8px 14px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>취소</button>
                  {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
                </div>
              </div>
            ) : (
              feedback && <div style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c", marginBottom: 10 }}>{feedback}</div>
            )
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div style={{ position: "relative" }}>
                  <div style={label11}>종목명 *</div>
                  <input
                    type="text"
                    value={form.stock || ""}
                    onChange={e => setForm(p => ({ ...p, stock: e.target.value }))}
                    onFocus={() => setShowStockDrop(true)}
                    onBlur={() => setTimeout(() => setShowStockDrop(false), 150)}
                    placeholder="종목명 *"
                    style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }}
                  />
                  {showStockDrop && recentStocks.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: "0 0 6px 6px", zIndex: 100, overflow: "hidden" }}>
                      {recentStocks.map(s => (
                        <div key={s}
                          onMouseDown={() => { setForm(p => ({ ...p, stock: s })); setShowStockDrop(false); }}
                          style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13, color: "#ddd" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#2a2d3a"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >{s}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={label11}>날짜 *</div>
                  <input type="date" value={form.date || ""} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                    style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box", colorScheme: "dark" }} />
                </div>
                <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8, padding: "6px 0 2px" }}>
                  <span style={{ fontSize: 11, color: "#555" }}>재무 데이터 (직접 입력 또는 0328로 채우기)</span>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", background: "#2a2d3a", border: "1px solid #3a3d4a", borderRadius: 5, cursor: "pointer", fontSize: 11, color: "#aaa" }}>
                    📋 0328 이미지
                    <input type="file" accept="image/*" style={{ display: "none" }}
                      onChange={async e => { const f = e.target.files[0]; if (f) { await fillFormFrom0397(f); e.target.value = ""; } }} />
                  </label>
                  {fill0397Loading && <span style={{ fontSize: 11, color: "#aaa" }}>⏳</span>}
                </div>
                {[["buyPrice","매수가","numcomma"],["sellPrice","매도가","numcomma"],["amount","매입금액","numcomma"],["pnl","실현손익","numcomma"],["pnlRate","수익률 (%)","number"]].map(([f,p,t]) => (
                  <div key={f}><div style={label11}>{p}</div>{inp(f, p, t)}</div>
                ))}
                <div>
                  <div style={label11}>매매 카테고리 *</div>
                  <select
                    value={TRADE_CATEGORIES.includes(form.technique) ? form.technique : (form.technique ? "기타" : "")}
                    onChange={e => {
                      const v = e.target.value;
                      if (v !== "기타") setForm(p => ({ ...p, technique: v }));
                      else setForm(p => ({ ...p, technique: "기타" }));
                    }}
                    style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, textAlign: "left" }}>
                    <option value="">선택 안함</option>
                    {TRADE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {(!TRADE_CATEGORIES.slice(0, -1).includes(form.technique) && form.technique !== "") && (
                    <input
                      value={form.technique === "기타" ? "" : form.technique}
                      onChange={e => setForm(p => ({ ...p, technique: e.target.value || "기타" }))}
                      placeholder="카테고리 직접 입력..."
                      autoFocus
                      style={{ width: "100%", marginTop: 6, background: "#13151f", border: "1px solid #4f8ef7", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }}
                    />
                  )}
                </div>
              </div>
              {[["reason","매매 이유","왜 이 자리에서 매수/매도했는지..."],["memo","메모","추가 메모..."]].map(([f,lbl,ph]) => (
                <div key={f} style={{ marginBottom: 10 }}>
                  <div style={label11}>{lbl}</div>
                  <textarea value={form[f]} onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))} onPaste={e => e.stopPropagation()} placeholder={ph}
                    style={{ width: "100%", minHeight: f === "reason" ? 80 : 60, background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: 10, fontSize: 13, resize: "vertical", boxSizing: "border-box", textAlign: "left" }} />
                </div>
              ))}
              {chartImg && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div style={label11}>첨부 차트</div>
                    <button onClick={() => setChartImg(null)}
                      style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 12 }}>제거</button>
                  </div>
                  <img src={`data:image/png;base64,${chartImg}`} alt="chart" style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #2a2d3a" }} />
                </div>
              )}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button onClick={handleSave} style={{ padding: "8px 20px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
                {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && view === "list" && !selected && listTab === "trash" && (
        trashLoading
          ? <div style={{ color: "#555", padding: 40, textAlign: "center" }}>로딩 중...</div>
          : trashTrades.length === 0
            ? <div style={{ color: "#555", marginTop: 40, textAlign: "center" }}>휴지통이 비어 있습니다</div>
            : <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#555", padding: "4px 2px" }}>10일 후 자동 영구삭제됩니다</div>
                {trashSelectMode && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#2a1a1a", borderRadius: 8, border: "1px solid #e74c3c" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "#aaa" }}>
                      <input type="checkbox"
                        checked={trashTrades.length > 0 && trashTrades.every(t => trashSelectedIds.has(t.id))}
                        onChange={e => setTrashSelectedIds(e.target.checked ? new Set(trashTrades.map(t => t.id)) : new Set())}
                        style={{ accentColor: "#e74c3c", width: 15, height: 15 }} />
                      전체선택
                    </label>
                    <span style={{ fontSize: 13, color: "#e74c3c", fontWeight: 600 }}>{trashSelectedIds.size}개 선택됨</span>
                    <button onClick={handleBulkTrashRestore} disabled={trashSelectedIds.size === 0}
                      style={{ padding: "5px 14px", background: trashSelectedIds.size > 0 ? "#27ae60" : "#1a2a1a", color: "#fff", border: "none", borderRadius: 6, cursor: trashSelectedIds.size > 0 ? "pointer" : "default", fontSize: 13 }}>복원</button>
                    <button onClick={handleBulkPermDelete} disabled={trashSelectedIds.size === 0}
                      style={{ padding: "5px 14px", background: trashSelectedIds.size > 0 ? "#e74c3c" : "#3a1a1a", color: "#fff", border: "none", borderRadius: 6, cursor: trashSelectedIds.size > 0 ? "pointer" : "default", fontSize: 13 }}>영구삭제</button>
                  </div>
                )}
                {trashTrades.map(t => {
                  const days = Math.max(0, 10 - Math.floor((Date.now() - new Date(t.deletedAt)) / 86400000));
                  const checked = trashSelectedIds.has(t.id);
                  return (
                    <div key={t.id}
                      onClick={() => trashSelectMode && setTrashSelectedIds(p => { const n = new Set(p); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                      style={{ ...box, borderColor: checked ? "#e74c3c" : "#3a2a2a", background: checked ? "#2a1a1a" : "#1a1d27", cursor: trashSelectMode ? "pointer" : "default" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {trashSelectMode && (
                          <input type="checkbox" checked={checked} readOnly
                            style={{ accentColor: "#e74c3c", width: 15, height: 15, cursor: "pointer", flexShrink: 0 }} />
                        )}
                        <span style={{ fontWeight: 700, color: "#aaa" }}>{t.stock}</span>
                        <span style={{ fontSize: 12, color: "#555" }}>{t.date}</span>
                        <span style={{ fontSize: 11, color: days <= 2 ? "#e74c3c" : "#555", marginLeft: "auto" }}>
                          {days === 0 ? "오늘 삭제됨" : `${days}일 후 영구삭제`}
                        </span>
                        {!trashSelectMode && <>
                          <button onClick={() => handleRestore(t.id)}
                            style={{ padding: "3px 10px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>복원</button>
                          <button onClick={() => handlePermDelete(t.id)}
                            style={{ padding: "3px 10px", background: "#3a1a1a", color: "#e74c3c", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>영구삭제</button>
                        </>}
                      </div>
                      {t.reason && <div style={{ marginTop: 5, fontSize: 12, color: "#555" }}>{t.reason.slice(0, 60)}...</div>}
                    </div>
                  );
                })}
              </div>
      )}

      {!loading && view === "list" && !selected && listTab !== "trash" && (() => {
        const filtered = applyTechFilter(trades);
        const sorted = sortTrades(filtered);
        if (sorted.length === 0) return <div style={{ color: "#555", marginTop: 40, textAlign: "center" }}>매매 기록 없음</div>;

        const toggleSelect = (id) => setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
        const allFiltered = sorted;
        const allSelected = allFiltered.length > 0 && allFiltered.every(t => selectedIds.has(t.id));

        const TradeRow = (t) => {
          const checked = selectedIds.has(t.id);
          return (
            <div key={t.id} id={`trade-row-${t.id}`}
              onClick={() => selectMode ? toggleSelect(t.id) : openDetail(t)}
              style={{ ...box, cursor: "pointer", borderColor: checked ? "#e74c3c" : "#2a2d3a", background: checked ? "#2a1a1a" : "#1a1d27", scrollMarginTop: isMobile ? 90 : 50 }}
              onMouseEnter={e => { if (!checked) e.currentTarget.style.borderColor = "#4f8ef7"; }}
              onMouseLeave={e => { if (!checked) e.currentTarget.style.borderColor = "#2a2d3a"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {selectMode && (
                  <input type="checkbox" checked={checked} readOnly
                    style={{ accentColor: "#e74c3c", width: 15, height: 15, cursor: "pointer", flexShrink: 0 }} />
                )}
                <span style={{ fontWeight: 700 }}>{t.stock}</span>
                {!groupByDate && <span style={{ fontSize: 12, color: "#666" }}>{t.date}</span>}
                {t.technique && <span style={{ background: categoryColor(t.technique), fontSize: 11, padding: "2px 7px", borderRadius: 4, color: "#fff" }}>{t.technique}</span>}
                <span style={{ marginLeft: "auto", fontWeight: 700, color: pnlColor(parseFloat(t.pnlRate)) }}>{parseFloat(t.pnlRate) > 0 ? "+" : ""}{t.pnlRate}%</span>
              </div>
              {t.reason && <div style={{ marginTop: 5, fontSize: 12, color: "#666", textAlign: "left" }}>{t.reason.slice(0, 80)}{t.reason.length > 80 ? "..." : ""}</div>}
            </div>
          );
        };

        const SelectBar = selectMode ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#2a1a1a", borderRadius: 8, marginBottom: 10, border: "1px solid #e74c3c" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "#aaa" }}>
              <input type="checkbox" checked={allSelected} onChange={e => setSelectedIds(e.target.checked ? new Set(allFiltered.map(t => t.id)) : new Set())}
                style={{ accentColor: "#e74c3c", width: 15, height: 15 }} />
              전체선택
            </label>
            <span style={{ fontSize: 13, color: "#e74c3c", fontWeight: 600 }}>{selectedIds.size}개 선택됨</span>
            <button onClick={handleBulkSoftDelete} disabled={selectedIds.size === 0}
              style={{ padding: "5px 16px", background: selectedIds.size > 0 ? "#e74c3c" : "#3a1a1a", color: "#fff", border: "none", borderRadius: 6, cursor: selectedIds.size > 0 ? "pointer" : "default", fontSize: 13 }}>
              🗑️ 선택 삭제
            </button>
          </div>
        ) : null;

        if (!groupByDate) return <div style={{ display: "grid", gap: 8 }}>{SelectBar}{sorted.map(TradeRow)}</div>;
        const grouped = sorted.reduce((acc, t) => { const d = t.date || "날짜없음"; (acc[d] = acc[d] || []).push(t); return acc; }, {});
        const sortedDates = [...new Set(sorted.map(t => t.date || "날짜없음"))];
        const dayPnl = (ts) => ts.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
        return (
          <div style={{ display: "grid", gap: 4 }}>
            {SelectBar}
            {sortedDates.map(date => (
              <div key={date} id={`date-sec-${date}`} style={{ scrollMarginTop: isMobile ? 90 : 50 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px", borderBottom: "1px solid #2a2d3a", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#4f8ef7" }}>📅 {date}</span>
                  <span style={{ fontSize: 11, color: "#555" }}>{grouped[date].length}건</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: pnlColor(dayPnl(grouped[date])) }}>
                    {dayPnl(grouped[date]) >= 0 ? "+" : ""}{dayPnl(grouped[date]).toLocaleString()}원
                  </span>
                </div>
                <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>{grouped[date].map(TradeRow)}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {!loading && view === "detail" && selected && (() => {
        const detailFiltered = sortTrades(applyTechFilter(trades));
        const detailIdx = detailFiltered.findIndex(t => t.id === selected.id);
        return (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button onClick={() => {
              window.history.replaceState({ ...(window.history.state || {}), journalView: "list" }, "");
              if (selected) scrollTargetRef.current = `trade-row-${selected.id}`;
              setView("list"); setSelected(null); setEditTrade(false); setFeedback(""); setDetailAiAnalysis(""); setSimilarTrades([]);
            }} style={{ background: "none", border: "none", color: "#4f8ef7", cursor: "pointer", fontSize: 13 }}>← 목록</button>
            <span style={{ flex: 1 }} />
            <button onClick={() => openDetail(detailFiltered[detailIdx - 1])} disabled={detailIdx <= 0}
              style={{ padding: "3px 10px", background: detailIdx > 0 ? "#2a2d3a" : "#1a1d27", border: "none", color: detailIdx > 0 ? "#aaa" : "#444", borderRadius: 5, cursor: detailIdx > 0 ? "pointer" : "default", fontSize: 12 }}>◀ 이전</button>
            <span style={{ fontSize: 12, color: "#555" }}>{detailIdx + 1} / {detailFiltered.length}</span>
            <button onClick={() => openDetail(detailFiltered[detailIdx + 1])} disabled={detailIdx >= detailFiltered.length - 1}
              style={{ padding: "3px 10px", background: detailIdx < detailFiltered.length - 1 ? "#2a2d3a" : "#1a1d27", border: "none", color: detailIdx < detailFiltered.length - 1 ? "#aaa" : "#444", borderRadius: 5, cursor: detailIdx < detailFiltered.length - 1 ? "pointer" : "default", fontSize: 12 }}>다음 ▶</button>
          </div>

          {!editTrade ? (
            <div style={box}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{selected.stock}</span>
                <span style={{ fontSize: 13, color: "#666" }}>{selected.date}</span>
                {selected.technique && <span style={{ background: categoryColor(selected.technique), fontSize: 12, padding: "2px 8px", borderRadius: 4, color: "#fff" }}>{selected.technique}</span>}
                <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 700, color: pnlColor(parseFloat(selected.pnlRate)) }}>{parseFloat(selected.pnlRate) > 0 ? "+" : ""}{selected.pnlRate}%</span>
                <button onClick={() => { setEditForm({ ...selected }); setEditTrade(true); setFeedback(""); setDeleteConfirmId(null); }}
                  style={{ padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>수정</button>
                <button onClick={handleDuplicate}
                  style={{ padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>📋 복제</button>
                {deleteConfirmId === selected.id ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#e74c3c" }}>삭제하시겠습니까?</span>
                    <button onClick={() => handleSoftDelete(selected.id)}
                      style={{ padding: "4px 10px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>확인</button>
                    <button onClick={() => setDeleteConfirmId(null)}
                      style={{ padding: "4px 10px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>취소</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirmId(selected.id)}
                    style={{ padding: "4px 10px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>🗑️ 삭제</button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
                {[["매수가", selected.buyPrice], ["매도가", selected.sellPrice], ["수익률", `${selected.pnlRate}%`], ["실현손익", selected.pnl], ["매입금액", selected.amount]].map(([l, v]) => {
                  const needsComma = ["매수가","매도가","실현손익","매입금액"].includes(l);
                  const display = needsComma ? (fmtNum(v) || "-") : (v || "-");
                  return (
                  <div key={l} style={{ background: "#13151f", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={label11}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: ["수익률","실현손익"].includes(l) ? pnlColor(parseFloat(v)) : "#ddd" }}>{display}</div>
                  </div>
                  );
                })}
              </div>
              {selected.reason && <div style={{ marginBottom: 10 }}><div style={label11}>매매 이유</div><div style={val14}>{selected.reason}</div></div>}
              {selected.memo && <div style={{ marginBottom: 10 }}><div style={label11}>메모</div><div style={val14}>{selected.memo}</div></div>}
              <div style={{ marginBottom: 10 }}>
                <div style={label11}>차트</div>
                {detailImgLoading
                  ? <div style={{ color: "#555", fontSize: 12, padding: "8px 0" }}>⏳ 이미지 로딩 중...</div>
                  : selected.chartImg
                    ? <img src={`data:image/jpeg;base64,${selected.chartImg}`} alt="chart" style={{ maxWidth: "100%", borderRadius: 6 }} />
                    : <div style={{ color: "#555", fontSize: 12, padding: "8px 0" }}>차트 없음</div>
                }
              </div>
              <div style={{ marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "#8e44ad", fontWeight: 600 }}>🤖 AI 분석</span>
                  {aiEditMode ? (
                    <>
                      <button onClick={handleCorrection} disabled={detailAiLoading}
                        style={{ padding: "3px 12px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
                        {detailAiLoading ? "분석 중..." : "✅ 수정 완료 (재분석)"}
                      </button>
                      <button onClick={() => setAiEditMode(false)}
                        style={{ padding: "3px 10px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>취소</button>
                    </>
                  ) : (
                    <>
                      <button onClick={analyzeDetailTrade} disabled={detailAiLoading}
                        style={{ padding: "3px 12px", background: detailAiLoading ? "#333" : "#8e44ad", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
                        {detailAiLoading ? "분석 중..." : (detailAiAnalysis || selected.aiAnalysis) ? "재분석" : "분석 시작"}
                      </button>
                      {(detailAiAnalysis || selected.aiAnalysis) && (
                        <button onClick={() => { setAiEditText(detailAiAnalysis || selected.aiAnalysis || ""); setAiEditMode(true); }}
                          style={{ padding: "3px 10px", background: "#2a3a2a", color: "#4caf50", border: "1px solid #4caf5055", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>✏️ 수정</button>
                      )}
                      {detailAiAnalysis && (
                        <button onClick={() => {
                          delete analysisCacheRef.current[selected.id];
                          setDetailAiAnalysis("");
                          setSimilarTrades(selected.aiAnalysis ? calcSimilarTrades(selected, trades) : []);
                        }} style={{ padding: "3px 10px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>초기화</button>
                      )}
                      {detailAiAnalysis && detailAiAnalysis !== selected.aiAnalysis && (
                        <button onClick={async () => {
                          try {
                            await sbPatch(selected.id, { ai_analysis: detailAiAnalysis });
                            setSelected(p => ({ ...p, aiAnalysis: detailAiAnalysis }));
                            setTrades(p => p.map(t => t.id === selected.id ? { ...t, aiAnalysis: detailAiAnalysis } : t));
                            setFeedback("✅ AI 분석 저장됨");
                          } catch (e) { setFeedback(`❌ ${e.message}`); }
                        }} style={{ padding: "3px 12px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>💾 저장</button>
                      )}
                      {(detailAiAnalysis || selected.aiAnalysis) && (
                        <button onClick={async () => {
                          try {
                            if (selected.aiAnalysis) {
                              await sbPatch(selected.id, { ai_analysis: null });
                              setSelected(p => ({ ...p, aiAnalysis: null }));
                              setTrades(p => p.map(t => t.id === selected.id ? { ...t, aiAnalysis: null } : t));
                            }
                            delete analysisCacheRef.current[selected.id];
                            setDetailAiAnalysis(""); setSimilarTrades([]);
                            setFeedback("✅ AI 분석 삭제됨");
                          } catch (e) { setFeedback(`❌ ${e.message}`); }
                        }} style={{ padding: "2px 8px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>삭제</button>
                      )}
                    </>
                  )}
                </div>
                {aiEditMode ? (
                  <textarea
                    value={aiEditText}
                    onChange={e => setAiEditText(e.target.value)}
                    onPaste={e => e.stopPropagation()}
                    style={{ width: "100%", minHeight: 320, background: "#0f1a10", border: "1px solid #4caf50", borderRadius: 8, color: "#e0e0e0", padding: 12, fontSize: 13, resize: "vertical", boxSizing: "border-box", lineHeight: 1.7, whiteSpace: "pre-wrap" }}
                  />
                ) : (
                  (detailAiAnalysis || selected.aiAnalysis) && <div style={{ ...val14, background: "#1a1330", border: "1px solid #8e44ad", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{detailAiAnalysis || selected.aiAnalysis}</div>
                )}
                {similarTrades.length > 0 && (
                  <div style={{ marginTop: 10, padding: "10px 12px", background: "#12161e", border: "1px solid #2a2d3a", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>📎 AI 선정 유사 매매 ({similarTrades.length}건)</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {similarTrades.map(t => (
                        <button key={t.id} onClick={() => openDetail(t)}
                          style={{ padding: "4px 12px", background: "#1a2030", border: `1px solid ${pnlColor(parseFloat(t.pnlRate))}55`, borderRadius: 20, cursor: "pointer", fontSize: 11, color: pnlColor(parseFloat(t.pnlRate)), whiteSpace: "nowrap" }}>
                          {t.date} / {t.stock}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {feedback && <div style={{ marginTop: 8, fontSize: 13, color: "#4caf50" }}>{feedback}</div>}
            </div>
          ) : (
            <div style={box} onPaste={async e => {
              const files = [];
              if (e.clipboardData?.items) for (const item of Array.from(e.clipboardData.items)) { if (item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) files.push(f); } }
              if (files.length === 0) return;
              e.preventDefault();
              if (editPasteMode === "0606") {
                await handleEditImageExtract(files[0]);
              } else {
                setEditImgLoading(true); setFeedback("");
                try {
                  const { trades, rowCount } = await extract0397Trades(files[0]);
                  const rowCountWarn = (rowCount && rowCount !== trades.length) ? ` ⚠️ 행 개수 불일치(이미지 ${rowCount}행 vs 추출 ${trades.length}행) - 다시 시도해보세요` : "";
                  const matches = editForm?.stock ? trades.filter(t => matchStock(t.stock, editForm.stock)) : [];
                  const m = merge0397Rows(matches.length > 0 ? matches : (editForm?.stock ? [] : trades.slice(0, 1)));
                  if (m) { setEditForm(f => ({ ...f, buyPrice: m.buyPrice ?? f.buyPrice, sellPrice: m.sellPrice ?? f.sellPrice, pnl: m.pnl ?? f.pnl, pnlRate: m.pnlRate ?? f.pnlRate, amount: m.buyAmount ?? f.amount })); setFeedback((matches.length > 1 ? `✅ ${matches.length}건 머지됨` : "✅ 재무 데이터 채워짐") + rowCountWarn); }
                  else setFeedback(`❌ '${editForm?.stock || ""}' 매칭 없음 (추출: ${trades.map(t => t.stock).join(", ")})${rowCountWarn}`);
                } catch (err) { setFeedback(`❌ ${err.message}`); }
                setEditImgLoading(false);
              }
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#aaa", marginBottom: 10 }}>수정 중: {selected.stock}</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#555" }}>Ctrl+V 붙여넣기 모드:</span>
                  {[["0606","📈 0606 차트"], ["0397","📋 0328 재무"]].map(([m, lbl]) => (
                    <button key={m} onClick={() => setEditPasteMode(m)}
                      style={{ padding: "3px 10px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 11, background: editPasteMode === m ? "#4f8ef7" : "#2a2d3a", color: editPasteMode === m ? "#fff" : "#aaa" }}>{lbl}</button>
                  ))}
                  {editImgLoading && <span style={{ fontSize: 11, color: "#aaa" }}>⏳</span>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "#2a2d3a", border: "1px dashed #4f8ef7", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#aaa" }}>
                    📎 [0606] 이미지 <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => { const f = e.target.files[0]; if (f) { await handleEditImageExtract(f); e.target.value = ""; } }} />
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "#2a2d3a", border: "1px dashed #3a3d4a", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#aaa" }}>
                    📋 [0328] 이미지 <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => {
                      const f = e.target.files[0]; if (!f) return;
                      setEditImgLoading(true); setFeedback("");
                      try {
                        const { trades, rowCount } = await extract0397Trades(f);
                        const rowCountWarn = (rowCount && rowCount !== trades.length) ? ` ⚠️ 행 개수 불일치(이미지 ${rowCount}행 vs 추출 ${trades.length}행) - 다시 시도해보세요` : "";
                        const matches = editForm?.stock ? trades.filter(t => matchStock(t.stock, editForm.stock)) : [];
                        const m = merge0397Rows(matches.length > 0 ? matches : (editForm?.stock ? [] : trades.slice(0, 1)));
                        if (m) { setEditForm(prev => ({ ...prev, buyPrice: m.buyPrice ?? prev.buyPrice, sellPrice: m.sellPrice ?? prev.sellPrice, pnl: m.pnl ?? prev.pnl, pnlRate: m.pnlRate ?? prev.pnlRate, amount: m.buyAmount ?? prev.amount })); setFeedback((matches.length > 1 ? `✅ ${matches.length}건 머지됨` : "✅ 재무 데이터 채워짐") + rowCountWarn); }
                        else setFeedback(`❌ '${editForm?.stock || ""}' 매칭 없음 (추출: ${trades.map(t => t.stock).join(", ")})${rowCountWarn}`);
                      } catch (err) { setFeedback(`❌ ${err.message}`); }
                      setEditImgLoading(false); e.target.value = "";
                    }} />
                  </label>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div style={{ position: "relative" }}>
                  <div style={label11}>종목명 *</div>
                  <input type="text" value={editForm.stock || ""} onChange={e => setEditForm(p => ({ ...p, stock: e.target.value }))} placeholder="종목명 *"
                    style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={label11}>날짜</div>
                  <input type="date" value={editForm.date || ""} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))}
                    style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box", colorScheme: "dark" }} />
                </div>
                {[["buyPrice","매수가","numcomma"],["sellPrice","매도가","numcomma"],["amount","매입금액","numcomma"],["pnl","실현손익","numcomma"],["pnlRate","수익률 (%)","number"]].map(([f,p,t]) => {
                  const comma = t === "numcomma";
                  return (
                  <div key={f}>
                    <div style={label11}>{p}</div>
                    <input
                      type={comma ? "text" : t}
                      inputMode={comma ? "numeric" : undefined}
                      value={comma ? fmtNum(editForm[f]) : (editForm[f] ?? "")}
                      onChange={e => {
                        const val = comma ? e.target.value.replace(/,/g, "") : e.target.value;
                        setEditForm(prev => autoCalc(prev, f, val));
                      }}
                      placeholder={p}
                      style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                  );
                })}
                <div>
                  <div style={label11}>매매 카테고리</div>
                  <select value={TRADE_CATEGORIES.includes(editForm.technique) ? editForm.technique : (editForm.technique ? "기타" : "")}
                    onChange={e => { const v = e.target.value; setEditForm(p => ({ ...p, technique: v !== "기타" ? v : "기타" })); }}
                    style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13 }}>
                    <option value="">선택 안함</option>
                    {TRADE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {(!TRADE_CATEGORIES.slice(0, -1).includes(editForm.technique) && editForm.technique !== "") && (
                    <input value={editForm.technique === "기타" ? "" : editForm.technique}
                      onChange={e => setEditForm(p => ({ ...p, technique: e.target.value || "기타" }))}
                      placeholder="카테고리 직접 입력..."
                      style={{ width: "100%", marginTop: 6, background: "#13151f", border: "1px solid #4f8ef7", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
                  )}
                </div>
              </div>
              {[["reason","매매 이유","왜 이 자리에서 매수/매도했는지..."],["memo","메모","추가 메모..."]].map(([f,lbl,ph]) => (
                <div key={f} style={{ marginBottom: 10 }}>
                  <div style={label11}>{lbl}</div>
                  <textarea value={editForm[f] || ""} onChange={e => setEditForm(p => ({ ...p, [f]: e.target.value }))} onPaste={e => e.stopPropagation()} placeholder={ph}
                    style={{ width: "100%", minHeight: f === "reason" ? 80 : 60, background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: 10, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
                </div>
              ))}
              {editForm.chartImg && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div style={label11}>차트 이미지</div>
                    <button onClick={() => setEditForm(p => ({ ...p, chartImg: null }))}
                      style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 12 }}>제거</button>
                  </div>
                  <img src={`data:image/jpeg;base64,${editForm.chartImg}`} alt="chart" style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #2a2d3a" }} />
                </div>
              )}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button onClick={handleEditSave} style={{ padding: "8px 20px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
                <button onClick={() => { setEditTrade(false); setFeedback(""); }}
                  style={{ padding: "8px 14px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>취소</button>
                {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
              </div>
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}

// ==================== 이미지 그리드 (드래그 순서변경) ====================
function ImgGrid({ images, onRemove, onReorder }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  if (!images?.length) return null;

  const handleDrop = (i) => {
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOverIdx(null); return; }
    const arr = [...images];
    const [item] = arr.splice(dragIdx, 1);
    arr.splice(i, 0, item);
    onReorder?.(arr);
    try { navigator.vibrate?.(20); } catch {}
    setDragIdx(null); setDragOverIdx(null);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {images.map((b64, i) => (
        <div key={i}
          draggable={!!onReorder}
          onDragStart={() => { setDragIdx(i); try { navigator.vibrate?.(10); } catch {}; }}
          onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
          onDragLeave={() => setDragOverIdx(null)}
          onDrop={() => handleDrop(i)}
          onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
          style={{ position: "relative", opacity: dragIdx === i ? 0.4 : 1, outline: dragOverIdx === i && dragIdx !== i ? "2px solid #4f8ef7" : "none", borderRadius: 8, cursor: onReorder ? "grab" : "default", transition: "opacity 0.15s" }}>
          <img src={`data:image/jpeg;base64,${b64}`} alt={`img${i}`}
            style={{ width: 100, height: 80, objectFit: "cover", borderRadius: 6, border: "1px solid #2a2d3a", display: "block", pointerEvents: "none" }} />
          {onRemove && (
            <button onClick={() => onRemove(i)}
              style={{ position: "absolute", top: 2, right: 2, background: "#e74c3c", border: "none", color: "#fff", borderRadius: "50%", width: 18, height: 18, cursor: "pointer", fontSize: 10, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          )}
          {onReorder && <div style={{ position: "absolute", bottom: 2, left: 0, right: 0, textAlign: "center", fontSize: 11, color: "#555", pointerEvents: "none" }}>⠿</div>}
        </div>
      ))}
    </div>
  );
}

// ==================== 실전매매 탭 ====================
function RealTradeTab() {
  const [lTrades, setLTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list");
  const [form, setForm] = useState({ title: "", stock: "", date: "", textContent: "", images: [] });
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editTrade, setEditTrade] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [similarTrades, setSimilarTrades] = useState([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [imgScale, setImgScale] = useState(1);
  const [contentTab, setContentTab] = useState("summary");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [groupByDate, setGroupByDate] = useState(false);
  const [scrollToDate, setScrollToDate] = useState(null);
  const imgPasteRef = useRef(null);
  const editImgPasteRef = useRef(null);
  const scrollTargetRef = useScrollRestore(view);
  const isMobile = useIsMobile();
  const lTradesRef = useRef([]);
  const selectedRef = useRef(null);
  useEffect(() => { lTradesRef.current = lTrades; }, [lTrades]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await sbGetLiveTrades();
      setLTrades(rows.map(rowToLiveTrade).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id));
    } catch (e) { setFeedback(`❌ 로드 실패: ${e.message}`); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // 브라우저 뒤로가기: 상세 → 목록
  useEffect(() => {
    window.history.replaceState({ ...(window.history.state || {}), liveView: "list" }, "");
    const handlePop = (e) => {
      const s = e.state || {};
      if (s.liveView === "detail" && s.liveId) {
        const t = lTradesRef.current.find(x => x.id === s.liveId);
        if (t) openDetail(t);
      } else if (selectedRef.current) {
        scrollTargetRef.current = `live-row-${selectedRef.current.id}`;
        setView("list"); setSelected(null); setFeedback(""); setEditTrade(false);
      }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 날짜 이동: 날짜별 보기로 전환 후 해당 날짜 섹션으로 스크롤
  useEffect(() => {
    if (!scrollToDate) return;
    const el = document.getElementById(`date-sec-${scrollToDate}`);
    if (el) {
      el.scrollIntoView({ behavior: "auto", block: "start" });
      setFeedback("");
    } else {
      setFeedback(`❌ ${scrollToDate} 매매 기록 없음`);
    }
    setScrollToDate(null);
  }, [scrollToDate, lTrades, groupByDate]);

  const calcSimilar = (trade, all) => {
    const src = trade.textContent || "";
    if (!src) return [];
    const tokens = [...new Set(src.split(/[\s,./!?()\[\]「」『』【】]+/).filter(w => w.length >= 2))];
    return all
      .filter(t => t.id !== trade.id)
      .map(t => ({ t, score: tokens.reduce((s, w) => s + ((t.textContent || "").includes(w) ? 1 : 0), 0) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ t }) => t);
  };

  const openDetail = async (trade) => {
    if (window.history.state?.liveId !== trade.id)
      window.history.pushState({ ...(window.history.state || {}), liveView: "detail", liveId: trade.id }, "");
    setSelected(trade); setView("detail"); setFeedback(""); setEditTrade(false);
    setAiAnalysis(""); setSimilarTrades(trade.aiAnalysis ? calcSimilar(trade, lTrades) : []);
    setImgIdx(0); setImgScale(1); setContentTab("summary"); setAiSummary("");
    // 이미지는 목록에서 제외되므로 상세 진입 시 지연 로딩 (이미 있으면 스킵)
    if (!trade.images || trade.images.length === 0) {
      const imgs = await sbGetLiveImages(trade.id);
      if (imgs.length) {
        const withImgs = { ...trade, images: imgs };
        setSelected(s => (s && s.id === trade.id ? { ...s, images: imgs } : s));
        setLTrades(p => p.map(t => t.id === trade.id ? withImgs : t));
      }
    }
  };

  const generateSummary = async () => {
    if (!selected?.textContent) { setFeedback("❌ 내용이 없습니다."); return; }
    setSummaryLoading(true);
    try {
      const result = await claude(
        "주식 실전매매 메시지 요약 전문가. 핵심 내용을 2-3문장으로 간결하게 요약.",
        `다음 실전매매 카카오톡 메시지를 요약해주세요:\n\n${selected.textContent}`,
        800, undefined, "claude-fable-5"
      );
      setAiSummary(result.trim());
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setSummaryLoading(false);
  };

  const saveSummary = async () => {
    try {
      await sbPatchLive(selected.id, { summary: aiSummary });
      const updated = { ...selected, summary: aiSummary };
      setSelected(updated); setLTrades(p => p.map(t => t.id === selected.id ? updated : t));
      setAiSummary(""); setFeedback("✅ 요약 저장됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleAddImage = async (file, target) => {
    try {
      const b64 = await compressImage(file);
      if (target === "form") setForm(f => ({ ...f, images: [...f.images, b64] }));
      else setEditForm(f => ({ ...f, images: [...(f.images || []), b64] }));
    } catch (e) { setFeedback(`❌ 이미지 오류: ${e.message}`); }
  };

  const handlePasteImg = (e, target) => {
    const files = [];
    if (e.clipboardData?.items) {
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) files.push(f); }
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    files.forEach(f => handleAddImage(f, target));
  };

  const handleSave = async () => {
    if (!form.stock) { setFeedback("❌ 종목명은 필수입니다."); return; }
    const trade = { ...form, id: Date.now(), createdAt: new Date().toLocaleDateString("ko-KR"), aiAnalysis: "" };
    try {
      await sbUpsert("live_trades", [liveTradeToRow(trade)]);
      setLTrades(p => [trade, ...p]);
      setForm({ title: "", stock: "", date: "", textContent: "", images: [] });
      setFeedback("✅ 저장됨"); setView("list");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleEditSave = async () => {
    if (!editForm.stock) { setFeedback("❌ 종목명은 필수입니다."); return; }
    try {
      await sbUpsert("live_trades", [liveTradeToRow(editForm)]);
      setLTrades(p => p.map(t => t.id === editForm.id ? editForm : t));
      setSelected(editForm); setEditTrade(false); setFeedback("✅ 수정됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleDelete = async (id) => {
    try {
      await sbDelete("live_trades", id);
      setLTrades(p => p.filter(t => t.id !== id));
      setSelected(null); setDeleteConfirmId(null); setView("list");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const analyzeDetail = async () => {
    if (!selected?.textContent) { setFeedback("❌ 내용이 없습니다."); return; }
    setAiLoading(true); setAiAnalysis("");
    try {
      const pastArr = lTrades.filter(t => t.id !== selected.id && t.textContent).slice(0, 10);
      const pastText = pastArr.map(t => `[ID:${t.id}] ${t.stock}(${t.date}): ${(t.textContent || "").slice(0, 80)}`).join('\n');
      const result = await claude(
        "주식 실전매매 분석 전문가. 카카오톡 매매 메시지를 분석하여 핵심 매매 패턴과 의도를 파악한다.",
        `[현재 실전매매]\n종목:${selected.stock} 날짜:${selected.date}\n내용:\n${selected.textContent}\n\n[과거 실전매매 참고]\n${pastText || "(없음)"}\n\n아래 항목을 분석:\n1. 매매 의도 및 전략\n2. 핵심 판단 근거\n3. 과거 유사 매매와 비교\n\n※ 응답 맨 마지막 줄에 과거 유사 매매 중 가장 유사한 것 최대 5개의 ID를 아래 형식으로만 출력(다른 텍스트 없이): SIMILAR:[id1,id2,...]`,
        2000, undefined, "claude-fable-5"
      );
      const simMatch = result.match(/SIMILAR:\[([\d,\s]*)\]/);
      const analysisText = result.replace(/\n?SIMILAR:\[[\d,\s]*\]\s*$/, '').trim();
      setAiAnalysis(analysisText);
      if (simMatch) {
        const ids = simMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        setSimilarTrades(pastArr.filter(t => ids.includes(t.id)));
      } else {
        setSimilarTrades(calcSimilar(selected, lTrades));
      }
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setAiLoading(false);
  };

  const iStyle = { width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => { window.history.replaceState({ ...(window.history.state || {}), liveView: "list", liveId: undefined }, ""); if (selected) scrollTargetRef.current = `live-row-${selected.id}`; setView("list"); setSelected(null); setFeedback(""); }}
          style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, background: view === "list" && !selected ? "#e74c3c" : "#2a2d3a", color: view === "list" && !selected ? "#fff" : "#aaa" }}>
          📋 목록 ({lTrades.length})
        </button>
        <button onClick={() => setGroupByDate(p => !p)}
          style={{ padding: "4px 10px", background: groupByDate ? "#e74c3c" : "#2a2d3a", border: "none", color: groupByDate ? "#fff" : "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>📅 날짜별</button>
        {view === "list" && !selected && (
          <input type="date" onChange={e => {
            const v = e.target.value;
            if (!v) return;
            setGroupByDate(true);
            setScrollToDate(v);
            e.target.value = "";
          }}
            style={{ background: "#2a2d3a", border: "none", borderRadius: 5, color: "#aaa", padding: "4px 8px", fontSize: 12, colorScheme: "dark", cursor: "pointer" }}
            title="날짜로 이동" />
        )}
        <button onClick={() => { if (view === "add") return; setView("add"); setSelected(null); setFeedback(""); setForm({ title: "", stock: "", date: "", textContent: "", images: [] }); }}
          style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, background: view === "add" ? "#e74c3c" : "#2a2d3a", color: view === "add" ? "#fff" : "#aaa" }}>
          추가
        </button>
        <button onClick={load} style={{ marginLeft: "auto", padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>🔄</button>
      </div>

      {loading && <div style={{ color: "#555", padding: 40, textAlign: "center" }}>로딩 중...</div>}

      {!loading && view === "add" && (
        <div style={box}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={label11}>제목</div>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="제목 (예: 눌림목 매매)" style={iStyle} />
            </div>
            <div>
              <div style={label11}>날짜</div>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ ...iStyle, colorScheme: "dark" }} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={label11}>종목명 * (콤마로 여러 종목 입력 가능)</div>
            <input value={form.stock} onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} placeholder="예: 삼성전자, SK하이닉스" style={iStyle} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={label11}>카카오톡 내용 (Ctrl+V — [용]으로 시작하는 메시지만 자동 추출)</div>
            <textarea
              value={form.textContent}
              onChange={e => setForm(f => ({ ...f, textContent: e.target.value }))}
              onPaste={e => {
                const text = e.clipboardData?.getData("text");
                if (text) {
                  e.preventDefault();
                  const filtered = filterKakaoText(text);
                  if (!filtered) return;
                  const ta = e.target;
                  const start = ta.selectionStart ?? ta.value.length;
                  const end = ta.selectionEnd ?? ta.value.length;
                  const next = ta.value.slice(0, start) + filtered + ta.value.slice(end);
                  setForm(f => ({ ...f, textContent: next }));
                  requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + filtered.length; });
                }
              }}
              placeholder="카카오톡 채팅 내용을 붙여넣으세요 (Ctrl+V)..."
              style={{ ...iStyle, minHeight: 120, resize: "vertical", lineHeight: 1.6, textAlign: "left" }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={label11}>차트 이미지 (Ctrl+V 또는 파일선택 — 복수 가능)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div ref={imgPasteRef} tabIndex={0} onPaste={e => handlePasteImg(e, "form")} onClick={() => imgPasteRef.current?.focus()}
                style={{ padding: "7px 14px", background: "#2a2d3a", border: "1px dashed #4f8ef7", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#aaa", outline: "none" }}>
                🖼️ Ctrl+V로 이미지 붙여넣기
              </div>
              <label style={{ padding: "7px 14px", background: "#2a2d3a", border: "1px solid #3a3d4a", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#aaa" }}>
                📎 파일 선택
                <input type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={e => { Array.from(e.target.files).forEach(f => handleAddImage(f, "form")); e.target.value = ""; }} />
              </label>
              {form.images.length > 0 && <span style={{ fontSize: 12, color: "#555" }}>{form.images.length}장</span>}
            </div>
            <ImgGrid images={form.images}
              onRemove={i => setForm(f => ({ ...f, images: f.images.filter((_, j) => j !== i) }))}
              onReorder={arr => setForm(f => ({ ...f, images: arr }))} />
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={handleSave} style={{ padding: "8px 20px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
            {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
          </div>
        </div>
      )}

      {!loading && view === "list" && !selected && (() => {
        if (lTrades.length === 0) return <div style={{ color: "#555", marginTop: 40, textAlign: "center" }}>실전매매 기록 없음</div>;
        const TradeRow = (t) => (
          <div key={t.id} id={`live-row-${t.id}`} onClick={() => openDetail(t)}
            style={{ ...box, cursor: "pointer", scrollMarginTop: isMobile ? 90 : 50 }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#e74c3c"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2d3a"}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 700 }}>{t.title || t.stock || "제목 없음"}</span>
              {!groupByDate && <span style={{ fontSize: 12, color: "#666" }}>{t.date}</span>}
              {t.images?.length > 0 && <span style={{ fontSize: 11, color: "#555" }}>🖼️ {t.images.length}장</span>}
              {t.aiAnalysis && <span style={{ fontSize: 11, color: "#8e44ad" }}>🤖</span>}
            </div>
            {t.stock && (
              <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {t.stock.split(",").map(s => s.trim()).filter(Boolean).map((s, i) => (
                  <span key={i} style={{ fontSize: 11, background: "#1e2130", border: "1px solid #2a2d3a", borderRadius: 10, padding: "1px 8px", color: "#8abeee" }}>{s}</span>
                ))}
              </div>
            )}
            {(t.summary || t.textContent) && (
              <div style={{ marginTop: 5, fontSize: 12, color: "#666", textAlign: "left" }}>
                {(t.summary || t.textContent).slice(0, 70)}{(t.summary || t.textContent).length > 70 ? "..." : ""}
              </div>
            )}
          </div>
        );

        if (!groupByDate) return <div style={{ display: "grid", gap: 8 }}>{lTrades.map(TradeRow)}</div>;
        const grouped = lTrades.reduce((acc, t) => { const d = t.date || "날짜없음"; (acc[d] = acc[d] || []).push(t); return acc; }, {});
        const sortedDates = [...new Set(lTrades.map(t => t.date || "날짜없음"))];
        return (
          <div style={{ display: "grid", gap: 4 }}>
            {sortedDates.map(date => (
              <div key={date} id={`date-sec-${date}`} style={{ scrollMarginTop: isMobile ? 90 : 50 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px", borderBottom: "1px solid #2a2d3a", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#e74c3c" }}>📅 {date}</span>
                  <span style={{ fontSize: 11, color: "#555" }}>{grouped[date].length}건</span>
                </div>
                <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>{grouped[date].map(TradeRow)}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {!loading && view === "detail" && selected && (() => {
        const idx = lTrades.findIndex(t => t.id === selected.id);
        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <button onClick={() => { scrollTargetRef.current = `live-row-${selected.id}`; setView("list"); setSelected(null); setFeedback(""); setAiAnalysis(""); setSimilarTrades([]); }}
                style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 13 }}>← 목록</button>
              <span style={{ flex: 1 }} />
              <button onClick={() => idx > 0 && openDetail(lTrades[idx - 1])} disabled={idx <= 0}
                style={{ padding: "3px 10px", background: idx > 0 ? "#2a2d3a" : "#1a1d27", border: "none", color: idx > 0 ? "#aaa" : "#444", borderRadius: 5, cursor: idx > 0 ? "pointer" : "default", fontSize: 12 }}>◀ 이전</button>
              <span style={{ fontSize: 12, color: "#555" }}>{idx + 1} / {lTrades.length}</span>
              <button onClick={() => idx < lTrades.length - 1 && openDetail(lTrades[idx + 1])} disabled={idx >= lTrades.length - 1}
                style={{ padding: "3px 10px", background: idx < lTrades.length - 1 ? "#2a2d3a" : "#1a1d27", border: "none", color: idx < lTrades.length - 1 ? "#aaa" : "#444", borderRadius: 5, cursor: idx < lTrades.length - 1 ? "pointer" : "default", fontSize: 12 }}>다음 ▶</button>
            </div>

            {!editTrade ? (
              <div style={box}>
                {/* 헤더: 종목/날짜/수정/삭제 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{selected.title || selected.stock || "제목 없음"}</span>
                  <span style={{ fontSize: 13, color: "#666" }}>{selected.date}</span>
                  {selected.title && selected.stock && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {selected.stock.split(",").map(s => s.trim()).filter(Boolean).map((s, i) => (
                        <span key={i} style={{ fontSize: 11, background: "#1e2130", border: "1px solid #2a2d3a", borderRadius: 10, padding: "1px 8px", color: "#8abeee" }}>{s}</span>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { if (editTrade) return; setEditForm({ ...selected }); setEditTrade(true); setFeedback(""); setDeleteConfirmId(null); }}
                    style={{ marginLeft: "auto", padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>수정</button>
                  {deleteConfirmId === selected.id ? (
                    <>
                      <span style={{ fontSize: 12, color: "#e74c3c" }}>삭제하시겠습니까?</span>
                      <button onClick={() => handleDelete(selected.id)} style={{ padding: "4px 10px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>확인</button>
                      <button onClick={() => setDeleteConfirmId(null)} style={{ padding: "4px 10px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>취소</button>
                    </>
                  ) : (
                    <button onClick={() => setDeleteConfirmId(selected.id)} style={{ padding: "4px 10px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>🗑️ 삭제</button>
                  )}
                </div>

                {/* 슬라이드쇼 — 고정 높이, 이미지 가운데 */}
                {selected.images?.length > 0 && (
                  <div style={{ position: "relative", background: "#0f1117", borderRadius: 8, overflow: "hidden", height: 500, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                    <img
                      key={imgIdx}
                      src={`data:image/jpeg;base64,${selected.images[Math.min(imgIdx, selected.images.length - 1)]}`}
                      alt="chart"
                      onLoad={e => {
                        const { naturalWidth: w, naturalHeight: h } = e.target;
                        setImgScale(w < 400 && h < 300 ? 2 : 1);
                      }}
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", transform: imgScale > 1 ? `scale(${imgScale})` : "none", transition: "transform 0.2s" }}
                    />
                    {selected.images.length > 1 && (
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "rgba(0,0,0,0.6)" }}>
                        <button onClick={() => { setImgIdx(p => Math.max(0, p - 1)); setImgScale(1); }} disabled={imgIdx === 0}
                          style={{ background: "none", border: "none", color: imgIdx > 0 ? "#fff" : "#444", cursor: imgIdx > 0 ? "pointer" : "default", fontSize: 18, padding: "0 8px" }}>◀</button>
                        <span style={{ fontSize: 12, color: "#ccc" }}>{imgIdx + 1} / {selected.images.length}</span>
                        <button onClick={() => { setImgIdx(p => Math.min(selected.images.length - 1, p + 1)); setImgScale(1); }} disabled={imgIdx >= selected.images.length - 1}
                          style={{ background: "none", border: "none", color: imgIdx < selected.images.length - 1 ? "#fff" : "#444", cursor: imgIdx < selected.images.length - 1 ? "pointer" : "default", fontSize: 18, padding: "0 8px" }}>▶</button>
                      </div>
                    )}
                  </div>
                )}

                {/* 요약/전체 탭 */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    {[["summary", "요약"], ["full", "전체"]].map(([key, label]) => (
                      <button key={key} onClick={() => setContentTab(key)}
                        style={{ padding: "4px 14px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12, background: contentTab === key ? "#e74c3c" : "#2a2d3a", color: contentTab === key ? "#fff" : "#aaa" }}>{label}</button>
                    ))}
                  </div>

                  {contentTab === "summary" && (
                    <div>
                      {selected.summary ? (
                        <div>
                          <div style={val14}>{selected.summary}</div>
                          <button onClick={async () => {
                            try {
                              await sbPatchLive(selected.id, { summary: null });
                              const updated = { ...selected, summary: null };
                              setSelected(updated); setLTrades(p => p.map(t => t.id === selected.id ? updated : t));
                            } catch (e) { setFeedback(`❌ ${e.message}`); }
                          }} style={{ marginTop: 6, padding: "2px 8px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>삭제</button>
                        </div>
                      ) : aiSummary ? (
                        <div>
                          <div style={val14}>{aiSummary}</div>
                          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                            <button onClick={saveSummary} style={{ padding: "4px 12px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>💾 저장</button>
                            <button onClick={() => setAiSummary("")} style={{ padding: "4px 10px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>초기화</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <button onClick={generateSummary} disabled={summaryLoading}
                            style={{ padding: "8px 18px", background: summaryLoading ? "#333" : "#e74c3c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, alignSelf: "flex-start" }}>
                            {summaryLoading ? "생성 중..." : "🤖 AI 요약 생성"}
                          </button>
                          <div style={{ fontSize: 12, color: "#555" }}>텍스트 내용을 AI로 요약합니다.</div>
                        </div>
                      )}
                    </div>
                  )}

                  {contentTab === "full" && (
                    <div style={{ ...val14, maxHeight: "224px", overflowY: "auto" }}>
                      {selected.textContent || <span style={{ color: "#555" }}>내용 없음</span>}
                    </div>
                  )}
                </div>

                {/* AI 분석 섹션 */}
                {selected.aiAnalysis && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={label11}>🤖 AI 분석 (저장됨)</span>
                      <button onClick={async () => {
                        try {
                          await sbPatchLive(selected.id, { ai_analysis: null });
                          const updated = { ...selected, aiAnalysis: null };
                          setSelected(updated); setLTrades(p => p.map(t => t.id === selected.id ? updated : t));
                          setFeedback("✅ AI 분석 삭제됨");
                        } catch (e) { setFeedback(`❌ ${e.message}`); }
                      }} style={{ padding: "2px 8px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>삭제</button>
                    </div>
                    <div style={{ ...val14, background: "#1a1330", border: "1px solid #8e44ad" }}>{selected.aiAnalysis}</div>
                  </div>
                )}
                <div style={{ marginTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "#8e44ad", fontWeight: 600 }}>🤖 AI 분석</span>
                    <button onClick={analyzeDetail} disabled={aiLoading}
                      style={{ padding: "3px 12px", background: aiLoading ? "#333" : "#8e44ad", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
                      {aiLoading ? "분석 중..." : aiAnalysis ? "재분석" : "분석 시작"}
                    </button>
                    {aiAnalysis && <button onClick={() => setAiAnalysis("")} style={{ padding: "3px 10px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>초기화</button>}
                    {aiAnalysis && (
                      <button onClick={async () => {
                        try {
                          await sbPatchLive(selected.id, { ai_analysis: aiAnalysis });
                          const updated = { ...selected, aiAnalysis };
                          setSelected(updated); setLTrades(p => p.map(t => t.id === selected.id ? updated : t));
                          setFeedback("✅ AI 분석 저장됨");
                        } catch (e) { setFeedback(`❌ ${e.message}`); }
                      }} style={{ padding: "3px 12px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>💾 저장</button>
                    )}
                  </div>
                  {aiAnalysis && <div style={{ ...val14, background: "#1a1330", border: "1px solid #8e44ad", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{aiAnalysis}</div>}
                  {similarTrades.length > 0 && (
                    <div style={{ marginTop: 10, padding: "10px 12px", background: "#12161e", border: "1px solid #2a2d3a", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>📎 AI 선정 유사 실전매매 ({similarTrades.length}건)</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {similarTrades.map(t => (
                          <button key={t.id} onClick={() => openDetail(t)}
                            style={{ padding: "4px 12px", background: "#1a2030", border: "1px solid #2a2d3a", borderRadius: 20, cursor: "pointer", fontSize: 11, color: "#aaa", whiteSpace: "nowrap" }}>
                            {t.date} / {t.stock}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {feedback && <div style={{ marginTop: 8, fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</div>}
              </div>
            ) : (
              <div style={box}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#aaa", marginBottom: 10 }}>수정 중: {editForm.title || editForm.stock}</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={label11}>제목</div>
                    <input value={editForm.title || ""} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="제목 (예: 눌림목 매매)" style={iStyle} />
                  </div>
                  <div>
                    <div style={label11}>날짜</div>
                    <input type="date" value={editForm.date || ""} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} style={{ ...iStyle, colorScheme: "dark" }} />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={label11}>종목명 * (콤마로 여러 종목 입력 가능)</div>
                  <input value={editForm.stock || ""} onChange={e => setEditForm(f => ({ ...f, stock: e.target.value }))} placeholder="예: 삼성전자, SK하이닉스" style={iStyle} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={label11}>내용 (Ctrl+V로 카카오톡 추가 가능)</div>
                  <textarea
                    value={editForm.textContent || ""}
                    onChange={e => setEditForm(f => ({ ...f, textContent: e.target.value }))}
                    onPaste={e => {
                      const text = e.clipboardData?.getData("text");
                      if (text) {
                        e.preventDefault();
                        const filtered = filterKakaoText(text);
                        if (!filtered) return;
                        const ta = e.target;
                        const start = ta.selectionStart ?? ta.value.length;
                        const end = ta.selectionEnd ?? ta.value.length;
                        const next = ta.value.slice(0, start) + filtered + ta.value.slice(end);
                        setEditForm(f => ({ ...f, textContent: next }));
                        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + filtered.length; });
                      }
                    }}
                    style={{ ...iStyle, minHeight: 120, resize: "vertical", lineHeight: 1.6, textAlign: "left" }}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={label11}>차트 이미지</div>
                    <label style={{ fontSize: 12, color: "#4f8ef7", cursor: "pointer" }}>
                      + 파일추가
                      <input type="file" accept="image/*" multiple style={{ display: "none" }}
                        onChange={e => { Array.from(e.target.files).forEach(f => handleAddImage(f, "edit")); e.target.value = ""; }} />
                    </label>
                  </div>
                  <div ref={editImgPasteRef} tabIndex={0} onPaste={e => handlePasteImg(e, "edit")} onClick={() => editImgPasteRef.current?.focus()}
                    style={{ padding: "6px 12px", background: "#2a2d3a", border: "1px dashed #3a3d4a", borderRadius: 6, color: "#555", fontSize: 12, cursor: "pointer", outline: "none", marginBottom: 8 }}>
                    🖼️ Ctrl+V로 이미지 추가
                  </div>
                  <ImgGrid images={editForm.images}
                    onRemove={i => setEditForm(f => ({ ...f, images: f.images.filter((_, j) => j !== i) }))}
                    onReorder={arr => setEditForm(f => ({ ...f, images: arr }))} />
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button onClick={handleEditSave} style={{ padding: "8px 20px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
                  <button onClick={() => { setEditTrade(false); setFeedback(""); }} style={{ padding: "8px 14px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>취소</button>
                  {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ==================== 통계 탭 ====================
const StatRow = ({ label, v }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #2a2d3a" }}>
    <span style={{ fontSize: 13, flex: 1, textAlign: "left" }}>{label}</span>
    <span style={{ fontSize: 12, color: "#777" }}>{v.total}건</span>
    <span style={{ fontSize: 12, color: v.wins / v.total >= 0.5 ? "#4caf50" : "#e74c3c" }}>{((v.wins / v.total) * 100).toFixed(0)}%</span>
    <span style={{ fontSize: 13, fontWeight: 600, color: pnlColor(v.pnl) }}>{v.pnl.toLocaleString()}원</span>
  </div>
);

function StatsTab() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState("overview");
  const [groupMode, setGroupMode] = useState("detail");

  useEffect(() => {
    sbGetTrades().then(rows => { setTrades(rows.map(rowToTrade)); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: "#555", padding: 40, textAlign: "center" }}>로딩 중...</div>;
  if (!trades.length) return <div style={{ color: "#555", marginTop: 40, textAlign: "center" }}>매매 데이터 없음</div>;

  const scored = trades.filter(t => t.pnlRate !== "" && t.pnlRate != null && t.pnlRate !== undefined);
  const total = scored.length;
  const wins = scored.filter(t => parseFloat(t.pnlRate) > 0).length;
  const totalPnl = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  const avgRate = total ? (scored.reduce((s, t) => s + (parseFloat(t.pnlRate) || 0), 0) / total).toFixed(2) : "0.00";

  const aggregate = (keyFn) => {
    const m = {};
    scored.forEach(t => {
      const k = keyFn(t);
      if (!m[k]) m[k] = { total: 0, wins: 0, pnl: 0 };
      m[k].total++; if (parseFloat(t.pnlRate) > 0) m[k].wins++; m[k].pnl += parseFloat(t.pnl) || 0;
    });
    return m;
  };

  const SUB_TABS = [
    ["overview", "개요"],
    ["technique", "기법별"],
    ["monthly", "월별"],
    ["weekday", "요일별"],
    ["stock", "종목별"],
  ];

  return (
    <div style={{ color: "#e0e0e0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
        {[["총 매매", total, "#ddd"], ["승률", `${((wins/total)*100).toFixed(1)}%`, wins/total >= 0.5 ? "#4caf50" : "#e74c3c"],
          ["총 손익", totalPnl.toLocaleString()+"원", pnlColor(totalPnl)], ["평균 수익률", `${avgRate}%`, pnlColor(parseFloat(avgRate))]
        ].map(([l, v, c]) => (
          <div key={l} style={{ ...box, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {SUB_TABS.map(([k, lbl]) => (
          <button key={k} onClick={() => setSubTab(k)}
            style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, background: subTab === k ? "#4f8ef7" : "#2a2d3a", color: subTab === k ? "#fff" : "#aaa" }}>{lbl}</button>
        ))}
      </div>

      {subTab === "overview" && (() => {
        const recent = [...trades].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id).slice(0, 10);
        return (
          <div style={box}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>최근 매매 10건</div>
            {recent.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #2a2d3a" }}>
                <span style={{ fontSize: 12, color: "#666", width: 80 }}>{t.date}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.stock}</span>
                {t.technique && <span style={{ background: categoryColor(t.technique), fontSize: 11, padding: "2px 7px", borderRadius: 4, color: "#fff" }}>{t.technique}</span>}
                <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: pnlColor(parseFloat(t.pnlRate)) }}>{parseFloat(t.pnlRate) > 0 ? "+" : ""}{t.pnlRate}%</span>
              </div>
            ))}
          </div>
        );
      })()}

      {subTab === "technique" && (() => {
        const byTech = aggregate(t => {
          const tech = t.technique || "미분류";
          if (groupMode === "group") return techGroupOf(tech);
          if (groupMode === "timing") return techTimingOf(tech);
          return tech;
        });
        const entries = Object.entries(byTech).sort((a, b) => b[1].pnl - a[1].pnl);
        return (
          <div style={box}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>기법별 통계</div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {[["detail", "세부기법"], ["group", "기법군"], ["timing", "진입시점"]].map(([k, lbl]) => (
                  <button key={k} onClick={() => setGroupMode(k)}
                    style={{ padding: "3px 10px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 11, background: groupMode === k ? "#4f8ef7" : "#2a2d3a", color: groupMode === k ? "#fff" : "#aaa" }}>{lbl}</button>
                ))}
              </div>
            </div>
            {entries.map(([k, v]) => <StatRow key={k} label={k} v={v} />)}
          </div>
        );
      })()}

      {subTab === "monthly" && (() => {
        const byMonth = aggregate(t => (t.date || "").slice(0, 7) || "날짜없음");
        const entries = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
        return (
          <div style={box}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>월별 통계</div>
            {entries.map(([k, v]) => <StatRow key={k} label={k} v={v} />)}
          </div>
        );
      })()}

      {subTab === "weekday" && (() => {
        const byDay = aggregate(t => {
          const d = dayOfWeek(t.date);
          return d === null ? "날짜없음" : DAY_NAMES[d];
        });
        const order = ["월", "화", "수", "목", "금", "토", "일", "날짜없음"];
        const entries = order.filter(k => byDay[k]).map(k => [k, byDay[k]]);
        return (
          <div style={box}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>요일별 통계</div>
            {entries.map(([k, v]) => <StatRow key={k} label={k} v={v} />)}
          </div>
        );
      })()}

      {subTab === "stock" && (() => {
        const byStock = aggregate(t => t.stock || "종목없음");
        const entries = Object.entries(byStock).sort((a, b) => b[1].pnl - a[1].pnl);
        return (
          <div style={box}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>종목별 통계 (손익순)</div>
            {entries.map(([k, v]) => <StatRow key={k} label={k} v={v} />)}
          </div>
        );
      })()}
    </div>
  );
}

// ==================== 메인 앱 ====================
export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [techniques, setTechniques] = useState([]);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    sbGet("techniques").then(rows => setTechniques(rows.map(rowToTech))).catch(() => {});
  }, []);

  const handleTabChange = (i) => {
    window.history.pushState({ appTab: i }, "");
    setActiveTab(i);
  };

  useEffect(() => {
    window.history.replaceState({ appTab: 0 }, "");
    const handlePop = (e) => {
      if (e.state?.appTab !== undefined) setActiveTab(e.state.appTab);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", background: "#0f1117", minHeight: "100vh", color: "#e0e0e0" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "#1a1d27", borderBottom: "1px solid #2a2d3a" }}>
        {/* 모바일: 타이틀 행 */}
        {isMobile && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #2a2d3a" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>📈 매매 시스템</span>
          </div>
        )}
        {/* 탭 바 */}
        <div style={{ display: "flex", alignItems: "center", overflowX: "auto", padding: isMobile ? "0 4px" : "0 20px", scrollbarWidth: "none" }}>
          {!isMobile && <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", padding: "14px 0", marginRight: 20, whiteSpace: "nowrap" }}>📈 매매 시스템</span>}
          {TABS.map((t, i) => (
            <button key={i} onClick={() => handleTabChange(i)}
              style={{ padding: isMobile ? "12px 12px" : "14px 18px", background: "none", border: "none",
                borderBottom: activeTab === i ? "2px solid #4f8ef7" : "2px solid transparent",
                color: activeTab === i ? "#fff" : "#666", cursor: "pointer",
                fontSize: isMobile ? 12 : 14, fontWeight: activeTab === i ? 600 : 400, whiteSpace: "nowrap", flexShrink: 0 }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: isMobile ? 12 : 20, maxWidth: 960, margin: "0 auto" }}>
        {activeTab === 0 && <DashboardTab onNavigate={handleTabChange} />}
        {activeTab === 1 && <JournalTab techniques={techniques} />}
        {activeTab === 2 && <StatsTab />}
        {activeTab === 3 && <LectureTab />}
        {activeTab === 4 && <RealTradeTab />}
      </div>
      {showScrollTop && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="맨 위로"
          style={{ position: "fixed", right: 20, bottom: 20, width: 44, height: 44, borderRadius: "50%", background: "#4f8ef7", color: "#fff", border: "none", cursor: "pointer", fontSize: 18, boxShadow: "0 2px 8px rgba(0,0,0,0.4)", zIndex: 150 }}>
          ↑
        </button>
      )}
    </div>
  );
}