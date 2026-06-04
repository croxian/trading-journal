import { useState, useEffect, useCallback, useRef } from "react";

// ==================== 상수 / 설정 ====================
const TABS = ["🏠 대시보드", "📝 매매일지", "📊 통계", "📚 강의록"];
const SB_URL = "https://vbdtrynddjryxcpgpisf.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiZHRyeW5kZGpyeXhjcGdwaXNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDI0MDEsImV4cCI6MjA5NTk3ODQwMX0.p3Bs8i-sNz6GodYIXLg1BzdrTxAc9-jB2dZRaOKCW3M";
const HDR = { "Content-Type": "application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Prefer": "resolution=merge-duplicates" };

// ==================== Supabase 유틸 ====================
const sbGet = async (table) => {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?select=*&order=id.asc`, { headers: HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const TRADE_LIST_FIELDS = "id,stock,date,buy_price,sell_price,amount,pnl,pnl_rate,reason,technique,memo,ai_analysis,chart_desc,created_at";
const sbGetTrades = async () => {
  const r = await fetch(`${SB_URL}/rest/v1/trades?select=${TRADE_LIST_FIELDS}&order=id.asc`, { headers: HDR });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
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

const techToRow = (t) => ({ id: t.id, name: t.name, category: t.category, timeframe: t.timeframe, entry: t.entry, exit: t.exit, pattern: t.pattern, tags: t.tags, notes: t.notes, raw_input: t.rawInput, created_at: t.createdAt });
const rowToTech = (r) => ({ id: r.id, name: r.name, category: r.category, timeframe: r.timeframe, entry: r.entry, exit: r.exit, pattern: r.pattern, tags: r.tags, notes: r.notes, rawInput: r.raw_input, createdAt: r.created_at });
const tradeToRow = (t) => ({ id: t.id, stock: t.stock, date: t.date, buy_price: t.buyPrice, sell_price: t.sellPrice, amount: t.amount, pnl: t.pnl, pnl_rate: t.pnlRate, reason: t.reason, technique: t.technique, memo: t.memo, chart_img: t.chartImg, ai_analysis: t.aiAnalysis, chart_desc: t.chartDesc, created_at: t.createdAt });
const rowToTrade = (r) => ({ id: r.id, stock: r.stock, date: r.date, buyPrice: r.buy_price, sellPrice: r.sell_price, amount: r.amount, pnl: r.pnl, pnlRate: r.pnl_rate, reason: r.reason, technique: r.technique, memo: r.memo, chartImg: r.chart_img, aiAnalysis: r.ai_analysis, chartDesc: r.chart_desc, createdAt: r.created_at });

// ==================== 매매 카테고리 ====================
const TRADE_CATEGORIES = [
  "상따",
  "양봉종배",
  "음봉종배",
  "상한가하락시작",
  "장중매매-돌파",
  "장중매매-눌림지지",
  "장중매매-투매",
  "투경해제",
  "단기과열",
  "무증매매",
  "악재매매",
  "기타",
];

// ==================== 공통 유틸 ====================
const categoryColor = (cat) => {
  if (!cat) return "#7f8c8d";
  if (cat.startsWith("장중매매")) return "#2980b9";
  return ({
    "상따": "#e74c3c",
    "양봉종배": "#e67e22",
    "음봉종배": "#8e44ad",
    "상한가하락시작": "#c0392b",
    "투경해제": "#27ae60",
    "단기과열": "#f39c12",
    "무증매매": "#16a085",
    "악재매매": "#7f8c8d",
    "기타": "#555",
  }[cat] || "#7f8c8d");
};
const pnlColor = (v) => v > 0 ? "#4caf50" : v < 0 ? "#e74c3c" : "#aaa";

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY || "";
const claude = async (system, userContent, maxTokens = 1000) => {
  const headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
  if (ANTHROPIC_KEY) headers["x-api-key"] = ANTHROPIC_KEY;
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers,
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages: [{ role: "user", content: userContent }] })
    });
  } catch (e) { throw new Error(`네트워크 오류 (CORS/연결): ${e.message}`); }
  if (!res.ok) {
    let msg = res.status;
    try { const d = await res.json(); msg = d.error?.message || msg; } catch {}
    throw new Error(`API 오류 ${res.status}: ${msg}`);
  }
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "";
};
const parseJSON = async (text) => {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error("JSON 없음");
  try { return JSON.parse(m[0]); } catch {}
  const fixed = m[0].replace(/:\s*"([\s\S]*?)(?<!\\)"(?=\s*[,}\]])/g, (_, v) =>
    `: "${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "").replace(/\t/g, "\\t")}"`);
  return JSON.parse(fixed);
};
const toBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = () => rej(new Error("파일 읽기 실패")); r.readAsDataURL(file); });

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
  const { default: JSZip } = await import("jszip");
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

const box = { background: "#1a1d27", borderRadius: 10, border: "1px solid #2a2d3a", padding: "14px 16px" };
const label11 = { fontSize: 11, color: "#555", marginBottom: 3, textAlign: "left" };
const val14 = { fontSize: 14, color: "#ddd", background: "#13151f", padding: "8px 10px", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.6, textAlign: "left" };

// ==================== 대시보드 탭 ====================
function DashboardTab({ onNavigate }) {
  const [trades, setTrades] = useState([]);
  const [techniques, setTechniques] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([sbGet("trades"), sbGet("techniques")])
      .then(([tr, te]) => { setTrades(tr.map(rowToTrade)); setTechniques(te.map(rowToTech)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: "#555", padding: 40, textAlign: "center" }}>로딩 중...</div>;

  const total = trades.length;
  const wins = trades.filter(t => parseFloat(t.pnlRate) > 0).length;
  const losses = trades.filter(t => parseFloat(t.pnlRate) < 0).length;
  const winRate = total ? ((wins / total) * 100).toFixed(1) : 0;
  const totalPnl = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  const avgWin = wins ? (trades.filter(t => parseFloat(t.pnlRate) > 0).reduce((s, t) => s + parseFloat(t.pnlRate), 0) / wins).toFixed(2) : 0;
  const avgLoss = losses ? (trades.filter(t => parseFloat(t.pnlRate) < 0).reduce((s, t) => s + parseFloat(t.pnlRate), 0) / losses).toFixed(2) : 0;
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

  // 기법별 승률
  const byTech = {};
  trades.forEach(t => {
    const k = t.technique || "미분류";
    if (!byTech[k]) byTech[k] = { total: 0, wins: 0 };
    byTech[k].total++; if (parseFloat(t.pnlRate) > 0) byTech[k].wins++;
  });

  const maxAbs = months.length ? Math.max(...months.map(([, v]) => Math.abs(v)), 1) : 1;

  return (
    <div style={{ color: "#e0e0e0" }}>
      {/* KPI 카드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
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

// ==================== Notion 동기화 ====================
const NOTION_TOKEN = import.meta.env.VITE_NOTION_TOKEN;
const NOTION_PARENT_ID = "373c885af5a4812ca6e7fab7e018abfe";
const NOTION_HDR = { "Authorization": `Bearer ${NOTION_TOKEN}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" };

const notionCreatePage = async (tech) => {
  const blocks = [];
  const addBlock = (label, content) => {
    if (!content) return;
    blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: [{ type: "text", text: { content: label } }] } });
    blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: String(content) } }] } });
  };

  addBlock("📌 매수 조건", tech.entry?.condition);
  addBlock("📍 매수 위치", tech.entry?.position);
  addBlock("⚠️ 주의사항", tech.entry?.caution);
  addBlock("✅ 익절 조건", tech.exit?.profit);
  addBlock("🛑 손절 조건", tech.exit?.loss);
  addBlock("📈 매수 전 구조", tech.pattern?.before);
  addBlock("⚡ 매수 트리거", tech.pattern?.trigger);
  addBlock("🔮 예상 흐름", tech.pattern?.after);
  addBlock("📝 메모", tech.notes);

  if (tech.rawInput) {
    blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: [{ type: "text", text: { content: "📄 원본 텍스트" } }] } });
    // Notion 블록 하나당 2000자 제한 → 청크 분할
    const raw = String(tech.rawInput);
    for (let i = 0; i < raw.length; i += 1900) {
      blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: raw.slice(i, i + 1900) } }] } });
    }
  }

  const title = `[${tech.category || "기타"}] ${tech.name || "이름없음"}`;
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST", headers: NOTION_HDR,
    body: JSON.stringify({
      parent: { page_id: NOTION_PARENT_ID },
      properties: { title: { title: [{ type: "text", text: { content: title } }] } },
      children: blocks.slice(0, 100)
    })
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

const notionGetChildren = async (pageId) => {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers: NOTION_HDR });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
};

const notionDeletePage = async (pageId) => {
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH", headers: NOTION_HDR,
    body: JSON.stringify({ archived: true })
  });
};

// ==================== 동기화 모달 ====================
function SyncModal({ onClose }) {
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState("idle");
  const addLog = (msg, color = "#aaa") => setLog(p => [...p, { msg, color }]);

  const runSync = async () => {
    setStatus("running"); setLog([]);
    try {
      // 1. Supabase에서 전체 기법 로드
      addLog("📥 Supabase에서 기법 로드 중...");
      const rows = await sbGet("techniques");
      const techs = rows.map(rowToTech);
      addLog(`✅ ${techs.length}개 기법 로드 완료`, "#4caf50");

      // 2. 기존 Notion 하위 페이지 삭제
      addLog("🗑️ 기존 Notion 페이지 삭제 중...");
      const children = await notionGetChildren(NOTION_PARENT_ID);
      const pages = children.filter(b => b.type === "child_page");
      for (const p of pages) {
        await notionDeletePage(p.id);
      }
      addLog(`✅ ${pages.length}개 기존 페이지 삭제 완료`, "#4caf50");

      // 3. 전체 재생성
      addLog("📝 Notion 페이지 생성 중...");
      let done = 0;
      for (const tech of techs) {
        await notionCreatePage(tech);
        done++;
        addLog(`  [${done}/${techs.length}] ${tech.name}`, "#888");
      }
      addLog("🎉 동기화 완료!", "#4f8ef7");
      setStatus("done");
    } catch (e) {
      addLog(`❌ 오류: ${e.message}`, "#e74c3c");
      setStatus("error");
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: 12, padding: 24, width: 500, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>🔄 Notion 동기화</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>
          Supabase 기법 전체를 Notion에 원본 그대로 재생성합니다.<br/>
          기존 Notion 페이지는 모두 삭제 후 재작성됩니다.
        </div>
        {status === "idle" && (
          <button onClick={runSync} style={{ padding: "10px 24px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
            동기화 시작
          </button>
        )}
        <div style={{ flex: 1, overflow: "auto", marginTop: 12, background: "#13151f", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 12, minHeight: 120 }}>
          {log.map((l, i) => <div key={i} style={{ color: l.color, marginBottom: 2 }}>{l.msg}</div>)}
          {status === "running" && <div style={{ color: "#aaa" }}>실행 중...</div>}
        </div>
        {(status === "done" || status === "error") && (
          <button onClick={onClose} style={{ marginTop: 12, padding: "8px 20px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>닫기</button>
        )}
      </div>
    </div>
  );
}
const LECTURE_SYSTEM = `단기 주식 매매 강의록을 구조화하는 전문가. 반드시 JSON만 출력.
입력 전처리: 인사말/감사/광고/잡담 제거.
{"name":"기법 이름","category":"갭하락매수|돌파매매|눌림매수|상한가하락시작|기타","timeframe":"3분봉 등","entry":{"condition":"","position":"","caution":""},"exit":{"profit":"","loss":""},"pattern":{"before":"","trigger":"","after":""},"tags":[],"notes":""}`;

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

  const load = useCallback(async () => {
    setLoading(true);
    try { const rows = await sbGet("techniques"); setTechniques(rows.map(rowToTech)); }
    catch (e) { setFeedback(`❌ 로드 실패: ${e.message}`); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

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
      const raw = await claude(LECTURE_SYSTEM, input, 1500);
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
              <div key={t.id} onClick={() => { setSelected(t); setView("detail"); setFeedback(""); }}
                style={{ ...box, cursor: "pointer" }}
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
          <button onClick={() => { setView("list"); setSelected(null); setEditMode(false); setFeedback(""); }}
            style={{ background: "none", border: "none", color: "#4f8ef7", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>← 목록</button>
          {!editMode ? (
            <div style={box}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ background: categoryColor(selected.category), color: "#fff", fontSize: 11, padding: "2px 7px", borderRadius: 4 }}>{selected.category}</span>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{selected.name}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button onClick={() => { setEditJson(JSON.stringify(selected, null, 2)); setEditRaw(selected.rawInput || ""); setEditSubMode("raw"); setEditMode(true); }}
                    style={{ padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>수정</button>
                  <button onClick={() => handleDelete(selected.id)}
                    style={{ padding: "4px 10px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>삭제</button>
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
  const [pendingPpt, setPendingPpt] = useState([]);
  const [pptLoading, setPptLoading] = useState(false);
  const [pptProgress, setPptProgress] = useState("");
  const [detailImgLoading, setDetailImgLoading] = useState(false);
  const pasteZoneRef = useRef(null);

  useEffect(() => {
    if (view === "add" && (inputMode === "img0606" || inputMode === "img0397")) {
      pasteZoneRef.current?.focus();
    }
  }, [view, inputMode]);

  const load = useCallback(async () => {
    setLoading(true);
    try { const rows = await sbGetTrades(); setTrades(rows.map(rowToTrade).sort((a,b) => b.id - a.id)); }
    catch (e) { setFeedback(`❌ 로드 실패: ${e.message}`); }
    setLoading(false);
  }, []);

  const openDetail = async (trade) => {
    setSelected(trade); setView("detail"); setFeedback(""); setEditTrade(false);
    setDetailImgLoading(true);
    const img = await sbGetChartImg(trade.id);
    setSelected(prev => prev?.id === trade.id ? { ...prev, chartImg: img } : prev);
    setDetailImgLoading(false);
  };
  useEffect(() => { load(); }, [load]);

  const recentStocks = [...new Set(trades.map(t => t.stock).filter(Boolean))].slice(0, 10);

  const processImage = async (file, mode) => {
    setImgLoading(true); setFeedback("");
    try {
      const b64 = await compressImage(file);
      const mediaType = "image/jpeg";
      if (mode === "0606") {
        setChartImg(b64);
        const raw = await claude("JSON만 출력.", [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: `키움 [0606] 자동일지차트에서 JSON 추출:\n{"stock":"종목명","date":"YYYY-MM-DD","buyPrice":매수가숫자,"sellPrice":매도가숫자,"pnlRate":수익률숫자,"chartDescription":"차트패턴설명"}\n확인불가는 null.` }
        ], 1000);
        const p = await parseJSON(raw);
        setForm(f => ({ ...f, stock: p.stock || "", date: p.date || "", buyPrice: p.buyPrice || "", sellPrice: p.sellPrice || "", pnlRate: p.pnlRate || "", chartDesc: p.chartDescription || "" }));
        setFeedback("✅ 차트 정보 추출 완료");
      } else {
        const raw = await claude("JSON만 출력.", [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: `키움 [0397] 매매일지에서 JSON 추출:\n{"date":"YYYY-MM-DD 또는 null","trades":[{"stock":"종목명","buyPrice":매수가,"sellPrice":매도가,"pnl":실현손익,"pnlRate":수익률,"buyAmount":매입금액}]}` }
        ], 1200);
        const p = await parseJSON(raw);
        const tradeList = Array.isArray(p) ? p : (p.trades || []);
        const extractedDate = (!Array.isArray(p) && p.date && p.date !== "null") ? p.date : "";
        if (tradeList.length > 0) {
          setPending0397(tradeList.map(f => ({
            stock: f.stock || "", buyPrice: f.buyPrice ?? "", sellPrice: f.sellPrice ?? "",
            pnl: f.pnl ?? "", pnlRate: f.pnlRate ?? "", amount: f.buyAmount ?? "",
          })));
          setBulk0397Date(extractedDate || new Date().toISOString().slice(0, 10));
          setFeedback(`✅ ${tradeList.length}개 종목 추출 완료`);
        } else {
          setFeedback("❌ 추출된 종목 없음");
        }
      }
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setImgLoading(false);
  };
  const handlePaste = async (e) => {
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
    const mode = inputMode === "img0606" ? "0606" : "0397";
    await processImage(imageFiles[0], mode);
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
    if (!form.stock || !form.buyPrice) { setFeedback("❌ 종목명과 매수가는 필수."); return; }
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
        ...t, date: bulk0397Date, id: base + i,
        createdAt: new Date().toLocaleDateString("ko-KR"),
        chartImg: null, aiAnalysis: "", reason: "", technique: "", memo: "", chartDesc: "",
      }));
      await sbUpsert("trades", newTrades.map(tradeToRow));
      setTrades(p => [...[...newTrades].reverse(), ...p]);
      setPending0397([]);
      setFeedback(`✅ ${newTrades.length}개 저장됨`);
      setView("list");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
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
          { type: "text", text: `슬라이드 텍스트:\n${texts || "(없음)"}\n\n이미지 중 키움증권 주식 차트(분봉/일봉)를 찾아 JSON 추출:\n{"chart_index":이미지번호(0부터,없으면null),"stock":"종목명","date":"YYYY-MM-DD","reason":"매매이유(불릿 포함 그대로)"}` }
        ];
        try {
          const raw = await claude("JSON만 출력.", content, 1500);
          const p = await parseJSON(raw);
          results.push({
            stock: p.stock || "", date: p.date || new Date().toISOString().slice(0, 10),
            reason: p.reason || "",
            chartImg: (p.chart_index != null && compressed[p.chart_index]) ? compressed[p.chart_index] : null,
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
        ...t, id: base + i, createdAt: new Date().toLocaleDateString("ko-KR"), aiAnalysis: "", chartDesc: "",
      }));
      await sbUpsert("trades", newTrades.map(tradeToRow));
      setTrades(p => [...[...newTrades].reverse(), ...p]);
      setPendingPpt([]); setFeedback(`✅ ${newTrades.length}개 저장됨`); setView("list");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleEditImageExtract = async (file) => {
    setEditImgLoading(true); setFeedback("");
    try {
      const b64 = await compressImage(file);
      const raw = await claude("JSON만 출력.", [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: `키움 [0606] 자동일지차트에서 JSON 추출:\n{"stock":"종목명","date":"YYYY-MM-DD","buyPrice":매수가숫자,"sellPrice":매도가숫자,"pnlRate":수익률숫자,"chartDescription":"차트패턴설명"}\n확인불가는 null.` }
      ], 1000);
      const p = await parseJSON(raw);
      setEditForm(f => ({
        ...f, chartImg: b64,
        ...(p.stock && { stock: p.stock }),
        ...(p.date && { date: p.date }),
        ...(p.buyPrice != null && { buyPrice: p.buyPrice }),
        ...(p.sellPrice != null && { sellPrice: p.sellPrice }),
        ...(p.pnlRate != null && { pnlRate: p.pnlRate }),
        ...(p.chartDescription && { chartDesc: p.chartDescription }),
      }));
      setFeedback("✅ 차트 정보 추출 완료");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setEditImgLoading(false);
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
    if (!editForm.stock || !editForm.buyPrice) { setFeedback("❌ 종목명과 매수가는 필수."); return; }
    try {
      await sbUpsert("trades", [tradeToRow(editForm)]);
      setTrades(p => p.map(t => t.id === editForm.id ? editForm : t));
      setSelected(editForm); setEditTrade(false); setFeedback("✅ 수정됨");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const handleDelete = async (id) => {
    try { await sbDelete("trades", id); setTrades(p => p.filter(t => t.id !== id)); setSelected(null); setView("list"); }
    catch (e) { setFeedback(`❌ ${e.message}`); }
  };

  const inp = (field, placeholder, type = "text") => (
    <input type={type} value={form[field] || ""} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))} placeholder={placeholder}
      style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box", textAlign: "left" }} />
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {[["list", `매매 목록 (${trades.length})`], ["add", "매매 추가"]].map(([t, label]) => (
          <button key={t} onClick={() => { setView(t); setSelected(null); setFeedback(""); setAiAnalysis(""); }}
            style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, background: view === t && !selected ? "#4f8ef7" : "#2a2d3a", color: view === t && !selected ? "#fff" : "#aaa" }}>{label}</button>
        ))}
        <button onClick={load} style={{ marginLeft: "auto", padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>🔄</button>
      </div>

      {loading && <div style={{ color: "#555", padding: 40, textAlign: "center" }}>로딩 중...</div>}

      {!loading && view === "add" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["img0606","📈 [0606]"], ["img0397","📋 [0397]"], ["ppt","📊 PPT"], ["manual","✏️ 직접입력"]].map(([m, label]) => (
              <button key={m} onClick={() => { setInputMode(m); setPending0397([]); setPendingPpt([]); setFeedback(""); }}
                style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, background: inputMode === m ? "#4f8ef7" : "#2a2d3a", color: inputMode === m ? "#fff" : "#aaa" }}>{label}</button>
            ))}
          </div>

          {(inputMode === "img0606" || inputMode === "img0397") && (
            <div
              ref={pasteZoneRef}
              tabIndex={0}
              onPaste={handlePaste}
              onClick={() => pasteZoneRef.current?.focus()}
              style={{ marginBottom: 14, outline: "none" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "#2a2d3a", border: "1px dashed #4f8ef7", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#aaa" }}>
                  📎 {inputMode === "img0606" ? "[0606] 차트 이미지" : "[0397] 매매내역 이미지"}
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
              ) : (
                <div>
                  <div style={{ fontSize: 13, color: "#aaa", marginBottom: 12 }}>{feedback}</div>
                  <div style={{ display: "grid", gap: 12, marginBottom: 14 }}>
                    {pendingPpt.map((t, i) => (
                      <div key={i} style={{ ...box, position: "relative" }}>
                        <button onClick={() => setPendingPpt(p => p.filter((_, j) => j !== i))}
                          style={{ position: "absolute", top: 10, right: 10, background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 14 }}>✕</button>
                        <div style={{ display: "grid", gridTemplateColumns: t.chartImg ? "120px 1fr" : "1fr", gap: 12, marginBottom: 10 }}>
                          {t.chartImg && <img src={`data:image/jpeg;base64,${t.chartImg}`} alt="chart" style={{ width: "100%", borderRadius: 6, border: "1px solid #2a2d3a" }} />}
                          <div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                              <div>
                                <div style={label11}>종목명 *</div>
                                <input value={t.stock} onChange={e => setPendingPpt(p => p.map((r,j) => j===i ? {...r, stock: e.target.value} : r))}
                                  style={{ width:"100%", background:"#13151f", border:"1px solid #2a2d3a", borderRadius:6, color:"#e0e0e0", padding:"6px 8px", fontSize:12, boxSizing:"border-box" }} />
                              </div>
                              <div>
                                <div style={label11}>날짜</div>
                                <input type="date" value={t.date} onChange={e => setPendingPpt(p => p.map((r,j) => j===i ? {...r, date: e.target.value} : r))}
                                  style={{ width:"100%", background:"#13151f", border:"1px solid #2a2d3a", borderRadius:6, color:"#e0e0e0", padding:"6px 8px", fontSize:12, boxSizing:"border-box", colorScheme:"dark" }} />
                              </div>
                            </div>
                            <div style={label11}>매매 이유</div>
                            <textarea value={t.reason} onChange={e => setPendingPpt(p => p.map((r,j) => j===i ? {...r, reason: e.target.value} : r))}
                              style={{ width:"100%", minHeight:60, background:"#13151f", border:"1px solid #2a2d3a", borderRadius:6, color:"#e0e0e0", padding:8, fontSize:12, resize:"vertical", boxSizing:"border-box" }} />
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                          {[["buyPrice","매수가"],["sellPrice","매도가"],["pnlRate","수익률(%)"],["pnl","실현손익"],["amount","매입금액"]].map(([f,lbl]) => (
                            <div key={f}>
                              <div style={label11}>{lbl}</div>
                              <input type="number" value={t[f]} onChange={e => setPendingPpt(p => p.map((r,j) => j===i ? {...r, [f]: e.target.value} : r))}
                                placeholder="-" style={{ width:"100%", background:"#13151f", border:"1px solid #2a2d3a", borderRadius:6, color:"#e0e0e0", padding:"6px 8px", fontSize:12, boxSizing:"border-box" }} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button onClick={handleBulkSavePpt} style={{ padding: "8px 20px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>전체 저장</button>
                    <button onClick={() => { setPendingPpt([]); setFeedback(""); }} style={{ padding: "8px 14px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>취소</button>
                  </div>
                </div>
              )}
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
                    const checked = sel0397.has(i);
                    return (
                      <div key={i} onClick={() => setSel0397(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                        style={{ display: "flex", alignItems: "center", gap: 8, background: checked ? "#1a2a3a" : "#13151f", border: `1px solid ${checked ? "#4f8ef7" : "transparent"}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} readOnly
                          style={{ accentColor: "#4f8ef7", width: 14, height: 14, cursor: "pointer" }} />
                        <span style={{ fontWeight: 600, minWidth: 80, color: "#ddd" }}>{t.stock}</span>
                        <span style={{ color: "#777" }}>매수 {t.buyPrice}</span>
                        <span style={{ color: "#777" }}>매도 {t.sellPrice}</span>
                        <span style={{ marginLeft: "auto", fontWeight: 700, color: pnlColor(parseFloat(t.pnlRate)) }}>
                          {parseFloat(t.pnlRate) > 0 ? "+" : ""}{t.pnlRate}%
                        </span>
                        <button onClick={e => { e.stopPropagation(); setPending0397(p => p.filter((_, j) => j !== i)); setSel0397(p => { const n = new Set(p); n.delete(i); return n; }); }}
                          style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>✕</button>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={handleBulkSave0397} style={{ padding: "8px 20px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>전체 저장</button>
                  {sel0397.size >= 2 && (
                    <button onClick={mergePending} style={{ padding: "8px 16px", background: "#27ae60", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
                      선택 머지 ({sel0397.size}건 → 1건)
                    </button>
                  )}
                  {sel0397.size > 0 && (
                    <button onClick={() => setSel0397(new Set())} style={{ padding: "8px 10px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>선택 해제</button>
                  )}
                  <button onClick={() => { setPending0397([]); setSel0397(new Set()); }} style={{ padding: "8px 14px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>취소</button>
                  {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
                </div>
              </div>
            ) : (
              feedback && <div style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c", marginBottom: 10 }}>{feedback}</div>
            )
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
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
                  <div style={label11}>날짜</div>
                  <input type="date" value={form.date || ""} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                    style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box", colorScheme: "dark" }} />
                </div>
                {[["buyPrice","매수가 *","number"],["sellPrice","매도가","number"],["amount","매입금액","number"],["pnl","실현손익","number"],["pnlRate","수익률 (%)","number"]].map(([f,p,t]) => (
                  <div key={f}><div style={label11}>{p}</div>{inp(f, p, t)}</div>
                ))}
                <div>
                  <div style={label11}>매매 카테고리</div>
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
                  <textarea value={form[f]} onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))} placeholder={ph}
                    style={{ width: "100%", minHeight: f === "reason" ? 80 : 60, background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: 10, fontSize: 13, resize: "vertical", boxSizing: "border-box", textAlign: "left" }} />
                </div>
              ))}
              {chartImg && <div style={{ marginBottom: 12 }}><div style={label11}>첨부 차트</div><img src={`data:image/png;base64,${chartImg}`} alt="chart" style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #2a2d3a" }} /></div>}
              <div style={{ marginBottom: 12 }}>
                <button onClick={handleAiAnalysis} disabled={aiLoading} style={{ padding: "8px 18px", background: aiLoading ? "#333" : "#8e44ad", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                  {aiLoading ? "분석 중..." : "🤖 AI 기법 분석"}
                </button>
                {aiAnalysis && <div style={{ marginTop: 10, background: "#1a1330", border: "1px solid #8e44ad", borderRadius: 8, padding: 14, fontSize: 13, color: "#ddd", lineHeight: 1.7, whiteSpace: "pre-wrap", textAlign: "left" }}>{aiAnalysis}</div>}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button onClick={handleSave} style={{ padding: "8px 20px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
                {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && view === "list" && !selected && (
        trades.length === 0
          ? <div style={{ color: "#555", marginTop: 40, textAlign: "center" }}>매매 기록 없음</div>
          : <div style={{ display: "grid", gap: 8 }}>
            {trades.map(t => (
              <div key={t.id} onClick={() => openDetail(t)}
                style={{ ...box, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#4f8ef7"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2d3a"}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 700 }}>{t.stock}</span>
                  <span style={{ fontSize: 12, color: "#666" }}>{t.date}</span>
                  {t.technique && <span style={{ background: categoryColor(t.technique), fontSize: 11, padding: "2px 7px", borderRadius: 4, color: "#fff" }}>{t.technique}</span>}
                  <span style={{ marginLeft: "auto", fontWeight: 700, color: pnlColor(parseFloat(t.pnlRate)) }}>{parseFloat(t.pnlRate) > 0 ? "+" : ""}{t.pnlRate}%</span>
                </div>
                {t.reason && <div style={{ marginTop: 5, fontSize: 12, color: "#666", textAlign: "left" }}>{t.reason.slice(0, 60)}...</div>}
              </div>
            ))}
          </div>
      )}

      {!loading && view === "detail" && selected && (
        <div>
          <button onClick={() => { setView("list"); setSelected(null); setEditTrade(false); setFeedback(""); }}
            style={{ background: "none", border: "none", color: "#4f8ef7", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>← 목록</button>

          {!editTrade ? (
            <div style={box}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{selected.stock}</span>
                <span style={{ fontSize: 13, color: "#666" }}>{selected.date}</span>
                {selected.technique && <span style={{ background: categoryColor(selected.technique), fontSize: 12, padding: "2px 8px", borderRadius: 4, color: "#fff" }}>{selected.technique}</span>}
                <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 700, color: pnlColor(parseFloat(selected.pnlRate)) }}>{parseFloat(selected.pnlRate) > 0 ? "+" : ""}{selected.pnlRate}%</span>
                <button onClick={() => { setEditForm({ ...selected }); setEditTrade(true); setFeedback(""); }}
                  style={{ padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>수정</button>
                <button onClick={() => handleDelete(selected.id)}
                  style={{ padding: "4px 10px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>삭제</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
                {[["매수가", selected.buyPrice], ["매도가", selected.sellPrice], ["수익률", `${selected.pnlRate}%`], ["실현손익", selected.pnl], ["매입금액", selected.amount]].map(([l, v]) => (
                  <div key={l} style={{ background: "#13151f", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={label11}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: ["수익률","실현손익"].includes(l) ? pnlColor(parseFloat(v)) : "#ddd" }}>{v || "-"}</div>
                  </div>
                ))}
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
              {selected.aiAnalysis && <div><div style={label11}>🤖 AI 분석</div><div style={{ ...val14, background: "#1a1330", border: "1px solid #8e44ad" }}>{selected.aiAnalysis}</div></div>}
              {feedback && <div style={{ marginTop: 8, fontSize: 13, color: "#4caf50" }}>{feedback}</div>}
            </div>
          ) : (
            <div style={box} onPaste={async e => {
              const files = [];
              if (e.clipboardData?.items) for (const item of Array.from(e.clipboardData.items)) { if (item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) files.push(f); } }
              if (files.length > 0) { e.preventDefault(); await handleEditImageExtract(files[0]); }
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#aaa", marginBottom: 12 }}>수정 중: {selected.stock}</div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>0606 차트로 자동채움 (선택)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", background: "#2a2d3a", border: "1px dashed #4f8ef7", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#aaa" }}>
                    📎 [0606] 이미지
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => { const f = e.target.files[0]; if (f) { await handleEditImageExtract(f); e.target.value = ""; } }} />
                  </label>
                  <span style={{ fontSize: 11, color: "#555" }}>또는 Ctrl+V</span>
                  {editImgLoading && <span style={{ fontSize: 12, color: "#aaa" }}>⏳ 추출 중...</span>}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
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
                {[["buyPrice","매수가 *","number"],["sellPrice","매도가","number"],["amount","매입금액","number"],["pnl","실현손익","number"],["pnlRate","수익률 (%)","number"]].map(([f,p,t]) => (
                  <div key={f}>
                    <div style={label11}>{p}</div>
                    <input type={t} value={editForm[f] ?? ""} onChange={e => setEditForm(prev => ({ ...prev, [f]: e.target.value }))} placeholder={p}
                      style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                ))}
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
                  <textarea value={editForm[f] || ""} onChange={e => setEditForm(p => ({ ...p, [f]: e.target.value }))} placeholder={ph}
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
      )}
    </div>
  );
}

// ==================== 통계 탭 ====================
function StatsTab() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sbGet("trades").then(rows => { setTrades(rows.map(rowToTrade)); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: "#555", padding: 40, textAlign: "center" }}>로딩 중...</div>;
  if (!trades.length) return <div style={{ color: "#555", marginTop: 40, textAlign: "center" }}>매매 데이터 없음</div>;

  const total = trades.length;
  const wins = trades.filter(t => parseFloat(t.pnlRate) > 0).length;
  const totalPnl = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  const avgRate = (trades.reduce((s, t) => s + (parseFloat(t.pnlRate) || 0), 0) / total).toFixed(2);

  const byTech = {};
  trades.forEach(t => {
    const k = t.technique || "미분류";
    if (!byTech[k]) byTech[k] = { total: 0, wins: 0, pnl: 0 };
    byTech[k].total++; if (parseFloat(t.pnlRate) > 0) byTech[k].wins++; byTech[k].pnl += parseFloat(t.pnl) || 0;
  });

  const byMonth = {};
  trades.forEach(t => {
    const m = (t.date || "").slice(0, 7); if (!m) return;
    if (!byMonth[m]) byMonth[m] = { total: 0, wins: 0, pnl: 0 };
    byMonth[m].total++; if (parseFloat(t.pnlRate) > 0) byMonth[m].wins++; byMonth[m].pnl += parseFloat(t.pnl) || 0;
  });

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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={box}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>기법별 통계</div>
          {Object.entries(byTech).map(([k, v]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #2a2d3a" }}>
              <span style={{ fontSize: 13, flex: 1, textAlign: "left" }}>{k}</span>
              <span style={{ fontSize: 12, color: "#777" }}>{v.total}건</span>
              <span style={{ fontSize: 12, color: v.wins/v.total >= 0.5 ? "#4caf50" : "#e74c3c" }}>{((v.wins/v.total)*100).toFixed(0)}%</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: pnlColor(v.pnl) }}>{v.pnl.toLocaleString()}원</span>
            </div>
          ))}
        </div>
        <div style={box}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>월별 통계</div>
          {Object.entries(byMonth).sort((a,b) => b[0].localeCompare(a[0])).map(([m, v]) => (
            <div key={m} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #2a2d3a" }}>
              <span style={{ fontSize: 13, flex: 1, textAlign: "left" }}>{m}</span>
              <span style={{ fontSize: 12, color: "#777" }}>{v.total}건</span>
              <span style={{ fontSize: 12, color: v.wins/v.total >= 0.5 ? "#4caf50" : "#e74c3c" }}>{((v.wins/v.total)*100).toFixed(0)}%</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: pnlColor(v.pnl) }}>{v.pnl.toLocaleString()}원</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== 메인 앱 ====================
export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [techniques, setTechniques] = useState([]);
  const [showSync, setShowSync] = useState(false);

  useEffect(() => {
    sbGet("techniques").then(rows => setTechniques(rows.map(rowToTech))).catch(() => {});
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", background: "#0f1117", minHeight: "100vh", color: "#e0e0e0" }}>
      {showSync && <SyncModal onClose={() => setShowSync(false)} />}
      <div style={{ background: "#1a1d27", borderBottom: "1px solid #2a2d3a", padding: "0 20px", display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", padding: "14px 0", marginRight: 20 }}>📈 매매 시스템</span>
        {TABS.map((t, i) => (
          <button key={i} onClick={() => setActiveTab(i)}
            style={{ padding: "14px 18px", background: "none", border: "none", borderBottom: activeTab === i ? "2px solid #4f8ef7" : "2px solid transparent",
              color: activeTab === i ? "#fff" : "#666", cursor: "pointer", fontSize: 14, fontWeight: activeTab === i ? 600 : 400 }}>{t}</button>
        ))}
        <button onClick={() => setShowSync(true)}
          style={{ marginLeft: "auto", padding: "6px 12px", background: "#2a2d3a", border: "1px solid #3a3d4a", color: "#aaa", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
          📒 Notion 동기화
        </button>
      </div>
      <div style={{ padding: 20, maxWidth: 960, margin: "0 auto" }}>
        {activeTab === 0 && <DashboardTab onNavigate={setActiveTab} />}
        {activeTab === 1 && <JournalTab techniques={techniques} />}
        {activeTab === 2 && <StatsTab />}
        {activeTab === 3 && <LectureTab />}
      </div>
    </div>
  );
}