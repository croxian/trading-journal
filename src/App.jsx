import { useState, useEffect } from "react";

// ==================== 상수 ====================
const TABS = ["📚 강의록", "📝 매매일지", "📊 통계"];

const categoryColor = (cat) => {
  const map = { "갭하락매수": "#e74c3c", "돌파매매": "#2980b9", "눌림매수": "#27ae60", "상한가하락시작": "#8e44ad", "기타": "#7f8c8d" };
  return map[cat] || "#7f8c8d";
};

const pnlColor = (v) => v > 0 ? "#4caf50" : v < 0 ? "#e74c3c" : "#aaa";

// ==================== API 유틸 ====================
const claude = async (system, userContent, maxTokens = 1000) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages: [{ role: "user", content: userContent }] })
  });
  const data = await res.json();
  if (data.error) throw new Error(`API 오류: ${data.error.message}`);
  return data.content?.map(b => b.text || "").join("") || "";
};

const parseJSON = async (text) => {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error("JSON 없음");
  try { return JSON.parse(m[0]); } catch {}
  const fixed = m[0].replace(/:\s*"([\s\S]*?)(?<!\\)"(?=\s*[,}\]])/g, (_, v) =>
    `: "${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "").replace(/\t/g, "\\t")}"`);
  try { return JSON.parse(fixed); } catch (e) { throw new Error(`파싱 오류: ${e.message}`); }
};

const toBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result.split(",")[1]);
  r.onerror = () => rej(new Error("파일 읽기 실패"));
  r.readAsDataURL(file);
});

// ==================== 강의록 탭 ====================
const LECTURE_SYSTEM = `당신은 단기 주식 매매 강의록을 구조화하는 전문가입니다. 반드시 JSON만 출력하세요.
입력 전처리: 인사말/감사/광고/잡담 제거.
{
  "name": "기법 이름",
  "category": "갭하락매수|돌파매매|눌림매수|상한가하락시작|기타",
  "timeframe": "3분봉 등",
  "entry": { "condition": "", "position": "", "caution": "" },
  "exit": { "profit": "", "loss": "" },
  "pattern": { "before": "", "trigger": "", "after": "" },
  "tags": [],
  "notes": ""
}`;

function LectureTab() {
  const [techniques, setTechniques] = useState(() => { try { return JSON.parse(localStorage.getItem("techniques_v1") || "[]"); } catch { return []; } });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editSubMode, setEditSubMode] = useState("raw");
  const [editJson, setEditJson] = useState("");
  const [editRaw, setEditRaw] = useState("");
  const [feedback, setFeedback] = useState("");
  const [view, setView] = useState("list");

  useEffect(() => { try { localStorage.setItem("techniques_v1", JSON.stringify(techniques)); } catch {} }, [techniques]);

  const extractPdf = async (file) => {
    const b64 = await toBase64(file);
    return claude("PDF에서 매매 기법 관련 텍스트만 추출. 광고/인사말/URL 제거. plain text만 출력.", [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
      { type: "text", text: "매매 기법 텍스트 추출해주세요." }
    ], 5000);
  };

  const handleAdd = async () => {
    if (!input.trim()) return;
    setLoading(true); setFeedback("");
    try {
      const raw = await claude(LECTURE_SYSTEM, input, 1500);
      const parsed = await parseJSON(raw);
      parsed.id = Date.now(); parsed.createdAt = new Date().toLocaleDateString("ko-KR"); parsed.rawInput = input;
      setTechniques(p => [...p, parsed]); setInput(""); setFeedback("✅ 저장됨"); setView("list");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setLoading(false);
  };

  const handlePdf = async (e, target) => {
    const file = e.target.files[0]; if (!file) return;
    if (target === "add") setPdfLoading("add"); else setPdfLoading("edit");
    setFeedback("");
    try {
      const text = await extractPdf(file);
      if (target === "add") setInput(p => p ? p + "\n\n" + text : text);
      else setEditRaw(text);
      setFeedback("✅ PDF 추출 완료");
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setPdfLoading(false); e.target.value = "";
  };

  const s = { background: "#0f1117", minHeight: "100%", color: "#e0e0e0", fontFamily: "sans-serif" };

  return (
    <div style={s}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["list","add"].map(t => (
          <button key={t} onClick={() => { setView(t); setSelected(null); setFeedback(""); }}
            style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13,
              background: view === t && !selected ? "#4f8ef7" : "#2a2d3a", color: view === t && !selected ? "#fff" : "#aaa" }}>
            {t === "list" ? `기법 목록 (${techniques.length})` : "기법 추가"}
          </button>
        ))}
      </div>

      {/* 추가 */}
      {view === "add" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center" }}>
            <label style={{ padding: "6px 14px", background: "#2a2d3a", color: "#aaa", borderRadius: 6, cursor: "pointer", fontSize: 13, border: "1px solid #3a3d4a" }}>
              📎 PDF <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => handlePdf(e, "add")} />
            </label>
            {pdfLoading === "add" && <span style={{ fontSize: 13, color: "#aaa" }}>⏳ 추출 중...</span>}
          </div>
          <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="기법을 자연어로 설명하세요..."
            style={{ width: "100%", minHeight: 140, background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: 8, color: "#e0e0e0", padding: 14, fontSize: 14, resize: "vertical", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <button onClick={handleAdd} disabled={loading} style={{ padding: "8px 20px", background: loading ? "#333" : "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              {loading ? "분석 중..." : "저장"}
            </button>
            {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
          </div>
        </div>
      )}

      {/* 목록 */}
      {view === "list" && !selected && (
        techniques.length === 0
          ? <div style={{ textAlign: "center", color: "#555", marginTop: 40 }}>저장된 기법 없음</div>
          : <div style={{ display: "grid", gap: 10 }}>
            {techniques.map(t => (
              <div key={t.id} onClick={() => { setSelected(t); setView("detail"); setFeedback(""); }}
                style={{ background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: 10, padding: "12px 16px", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#4f8ef7"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2d3a"}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: categoryColor(t.category), color: "#fff", fontSize: 11, padding: "2px 7px", borderRadius: 4 }}>{t.category}</span>
                  <span style={{ fontWeight: 600 }}>{t.name}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>{t.createdAt}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>{t.entry?.condition?.slice(0, 80)}...</div>
                <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {t.tags?.map(tag => <span key={tag} style={{ background: "#2a2d3a", fontSize: 11, padding: "1px 6px", borderRadius: 4, color: "#aaa" }}>#{tag}</span>)}
                </div>
              </div>
            ))}
          </div>
      )}

      {/* 상세 */}
      {view === "detail" && selected && (
        <div>
          <button onClick={() => { setView("list"); setSelected(null); setEditMode(false); setFeedback(""); }}
            style={{ background: "none", border: "none", color: "#4f8ef7", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>← 목록</button>
          {!editMode ? (
            <div style={{ background: "#1a1d27", borderRadius: 10, border: "1px solid #2a2d3a", padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ background: categoryColor(selected.category), color: "#fff", fontSize: 11, padding: "2px 7px", borderRadius: 4 }}>{selected.category}</span>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{selected.name}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button onClick={() => { setEditJson(JSON.stringify(selected, null, 2)); setEditRaw(selected.rawInput || ""); setEditSubMode("raw"); setEditMode(true); }}
                    style={{ padding: "4px 10px", background: "#2a2d3a", border: "none", color: "#aaa", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>수정</button>
                  <button onClick={() => { setTechniques(p => p.filter(t => t.id !== selected.id)); setSelected(null); setView("list"); }}
                    style={{ padding: "4px 10px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>삭제</button>
                </div>
              </div>
              {[
                ["📌 매수 조건", selected.entry?.condition], ["📍 매수 위치", selected.entry?.position],
                ["⚠️ 주의", selected.entry?.caution], ["✅ 익절", selected.exit?.profit],
                ["🛑 손절", selected.exit?.loss], ["📈 매수 전", selected.pattern?.before],
                ["⚡ 트리거", selected.pattern?.trigger], ["🔮 예상 흐름", selected.pattern?.after],
                ["📝 메모", selected.notes], ["📄 원본", selected.rawInput],
              ].map(([label, content]) => content ? (
                <div key={label} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 13, color: "#ddd", background: "#13151f", padding: "8px 10px", borderRadius: 6, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{content}</div>
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
                {["raw","json"].map(m => (
                  <button key={m} onClick={() => setEditSubMode(m)}
                    style={{ padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13,
                      background: editSubMode === m ? "#4f8ef7" : "#2a2d3a", color: editSubMode === m ? "#fff" : "#aaa" }}>
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
                    style={{ width: "100%", minHeight: 180, background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 8, color: "#e0e0e0", padding: 12, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <button onClick={() => { const u = { ...selected, rawInput: editRaw }; setTechniques(p => p.map(t => t.id === u.id ? u : t)); setSelected(u); setEditMode(false); setFeedback("✅ 저장됨"); }}
                      style={{ padding: "6px 16px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
                    <button onClick={() => setEditMode(false)} style={{ padding: "6px 16px", background: "#2a2d3a", color: "#aaa", border: "none", borderRadius: 6, cursor: "pointer" }}>취소</button>
                    {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
                  </div>
                </div>
              ) : (
                <div>
                  <textarea value={editJson} onChange={e => setEditJson(e.target.value)}
                    style={{ width: "100%", minHeight: 360, background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 8, color: "#e0e0e0", padding: 12, fontSize: 12, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                    <button onClick={() => { try { const u = JSON.parse(editJson); setTechniques(p => p.map(t => t.id === u.id ? u : t)); setSelected(u); setEditMode(false); setFeedback("✅ 저장됨"); } catch { setFeedback("❌ JSON 오류"); } }}
                      style={{ padding: "6px 16px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
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
  const [trades, setTrades] = useState(() => { try { return JSON.parse(localStorage.getItem("trades_v1") || "[]"); } catch { return []; } });
  const [view, setView] = useState("list"); // list | add | detail
  const [inputMode, setInputMode] = useState("img0606"); // img0606 | img0397 | manual
  const [form, setForm] = useState({ stock: "", date: "", buyPrice: "", sellPrice: "", amount: "", pnl: "", pnlRate: "", reason: "", technique: "", memo: "" });
  const [imgLoading, setImgLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState(null);
  const [chartImg, setChartImg] = useState(null); // base64
  const [aiAnalysis, setAiAnalysis] = useState("");

  useEffect(() => { try { localStorage.setItem("trades_v1", JSON.stringify(trades)); } catch {} }, [trades]);

  const handleImageExtract = async (e, type) => {
    const file = e.target.files[0]; if (!file) return;
    setImgLoading(true); setFeedback("");
    try {
      const b64 = await toBase64(file);
      const mediaType = file.type || "image/png";

      if (type === "0606") {
        // 자동일지차트 - 차트 저장 + 기본 정보 추출
        setChartImg(b64);
        const prompt = `이 키움 [0606] 자동일지차트 이미지에서 다음 정보를 JSON으로 추출하세요.
{
  "stock": "종목명",
  "date": "날짜 (YYYY-MM-DD)",
  "buyPrice": 매수가(숫자),
  "sellPrice": 매도가(숫자),
  "pnlRate": 수익률(숫자, % 제외),
  "chartDescription": "차트 패턴 설명 (B/S 위치, 캔들 구조, 고점/저점 등)"
}
숫자는 콤마 없이 순수 숫자만. 확인 불가 항목은 null.`;
        const raw = await claude("JSON만 출력하세요.", [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: prompt }
        ], 1000);
        const parsed = await parseJSON(raw);
        setForm(p => ({ ...p, stock: parsed.stock || "", date: parsed.date || "", buyPrice: parsed.buyPrice || "", sellPrice: parsed.sellPrice || "", pnlRate: parsed.pnlRate || "", chartDesc: parsed.chartDescription || "" }));
        setFeedback("✅ 차트 정보 추출 완료");
      } else {
        // 0397 매매내역 - 여러 종목 추출
        const prompt = `키움 [0397] 종목별 매매일지 이미지에서 모든 종목의 매매 정보를 JSON 배열로 추출하세요.
[{ "stock": "종목명", "buyPrice": 매수가, "sellPrice": 매도가, "pnl": 실현손익, "pnlRate": 수익률, "buyAmount": 매입금액, "sellAmount": 매도금액 }]
숫자는 콤마 없이 순수 숫자만.`;
        const raw = await claude("JSON만 출력하세요.", [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: prompt }
        ], 1000);
        const parsed = await parseJSON(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const first = parsed[0];
          setForm(p => ({ ...p, stock: first.stock || "", buyPrice: first.buyPrice || "", sellPrice: first.sellPrice || "", pnl: first.pnl || "", pnlRate: first.pnlRate || "", amount: first.buyAmount || "" }));
          if (parsed.length > 1) setFeedback(`✅ ${parsed.length}개 종목 추출됨. 첫 번째 종목 입력됨. 나머지는 별도 추가 필요.`);
          else setFeedback("✅ 매매 정보 추출 완료");
        }
      }
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setImgLoading(false); e.target.value = "";
  };

  const handleAiAnalysis = async () => {
    if (!form.reason && !form.chartDesc) { setFeedback("❌ 매매 이유 또는 차트 설명이 필요합니다."); return; }
    setAiLoading(true); setFeedback("");
    try {
      const techSummary = techniques.map(t => `[${t.name}] 카테고리:${t.category} / 매수조건:${t.entry?.condition} / 트리거:${t.pattern?.trigger} / 태그:${t.tags?.join(",")}`).join("\n");
      const prompt = `아래 매매 정보와 강의록 DB를 비교 분석해주세요.

[매매 정보]
종목: ${form.stock}, 날짜: ${form.date}
매수가: ${form.buyPrice}, 매도가: ${form.sellPrice}, 수익률: ${form.pnlRate}%
매매 이유: ${form.reason}
차트 설명: ${form.chartDesc || "없음"}

[강의록 DB]
${techSummary}

다음 항목으로 분석해주세요:
1. 가장 유사한 기법 (있다면)
2. 기법과 일치하는 점
3. 기법과 불일치하거나 아쉬운 점
4. 종합 의견`;
      const result = await claude("주식 매매 코치입니다. 객관적이고 구체적으로 분석해주세요.", prompt, 1500);
      setAiAnalysis(result);
    } catch (e) { setFeedback(`❌ ${e.message}`); }
    setAiLoading(false);
  };

  const handleSave = () => {
    if (!form.stock || !form.buyPrice) { setFeedback("❌ 종목명과 매수가는 필수입니다."); return; }
    const trade = { ...form, id: Date.now(), createdAt: new Date().toLocaleDateString("ko-KR"), chartImg, aiAnalysis };
    setTrades(p => [trade, ...p]);
    setForm({ stock: "", date: "", buyPrice: "", sellPrice: "", amount: "", pnl: "", pnlRate: "", reason: "", technique: "", memo: "" });
    setChartImg(null); setAiAnalysis(""); setFeedback("✅ 저장됨"); setView("list");
  };

  const inp = (field, placeholder, type = "text") => (
    <input type={type} value={form[field] || ""} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
      placeholder={placeholder}
      style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
  );

  return (
    <div style={{ background: "#0f1117", minHeight: "100%", color: "#e0e0e0", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["list","add"].map(t => (
          <button key={t} onClick={() => { setView(t); setSelected(null); setFeedback(""); setAiAnalysis(""); }}
            style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13,
              background: view === t && !selected ? "#4f8ef7" : "#2a2d3a", color: view === t && !selected ? "#fff" : "#aaa" }}>
            {t === "list" ? `매매 목록 (${trades.length})` : "매매 추가"}
          </button>
        ))}
      </div>

      {/* 매매 추가 */}
      {view === "add" && (
        <div>
          {/* 입력 방식 선택 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["img0606","📈 [0606] 차트"], ["img0397","📋 [0397] 매매내역"], ["manual","✏️ 직접입력"]].map(([m, label]) => (
              <button key={m} onClick={() => setInputMode(m)}
                style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12,
                  background: inputMode === m ? "#4f8ef7" : "#2a2d3a", color: inputMode === m ? "#fff" : "#aaa" }}>
                {label}
              </button>
            ))}
          </div>

          {/* 이미지 업로드 */}
          {(inputMode === "img0606" || inputMode === "img0397") && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px",
                background: "#2a2d3a", border: "1px dashed #4f8ef7", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#aaa" }}>
                📎 {inputMode === "img0606" ? "[0606] 차트 이미지 첨부" : "[0397] 매매내역 이미지 첨부"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleImageExtract(e, inputMode === "img0606" ? "0606" : "0397")} />
              </label>
              {imgLoading && <span style={{ marginLeft: 12, fontSize: 13, color: "#aaa" }}>⏳ 추출 중...</span>}
            </div>
          )}

          {/* 폼 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div><div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>종목명 *</div>{inp("stock", "삼화콘덴서")}</div>
            <div><div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>날짜</div>{inp("date", "2024-01-08")}</div>
            <div><div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>매수가 *</div>{inp("buyPrice", "117600", "number")}</div>
            <div><div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>매도가</div>{inp("sellPrice", "114700", "number")}</div>
            <div><div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>매입금액</div>{inp("amount", "2352000", "number")}</div>
            <div><div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>실현손익</div>{inp("pnl", "-63278", "number")}</div>
            <div><div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>수익률 (%)</div>{inp("pnlRate", "-2.69", "number")}</div>
            <div>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>기법 분류</div>
              <select value={form.technique} onChange={e => setForm(p => ({ ...p, technique: e.target.value }))}
                style={{ width: "100%", background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: "8px 10px", fontSize: 13 }}>
                <option value="">선택 안함</option>
                {techniques.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>매매 이유</div>
            <textarea value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="왜 이 자리에서 매수/매도했는지 서술..."
              style={{ width: "100%", minHeight: 80, background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: 10, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>메모</div>
            <textarea value={form.memo} onChange={e => setForm(p => ({ ...p, memo: e.target.value }))} placeholder="추가 메모..."
              style={{ width: "100%", minHeight: 60, background: "#13151f", border: "1px solid #2a2d3a", borderRadius: 6, color: "#e0e0e0", padding: 10, fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
          </div>

          {/* 차트 미리보기 */}
          {chartImg && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>첨부 차트</div>
              <img src={`data:image/png;base64,${chartImg}`} alt="chart" style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #2a2d3a" }} />
            </div>
          )}

          {/* AI 분석 */}
          <div style={{ marginBottom: 12 }}>
            <button onClick={handleAiAnalysis} disabled={aiLoading}
              style={{ padding: "8px 18px", background: aiLoading ? "#333" : "#8e44ad", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
              {aiLoading ? "분석 중..." : "🤖 AI 기법 분석"}
            </button>
            {aiAnalysis && (
              <div style={{ marginTop: 10, background: "#1a1330", border: "1px solid #8e44ad", borderRadius: 8, padding: 14, fontSize: 13, color: "#ddd", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {aiAnalysis}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={handleSave} style={{ padding: "8px 20px", background: "#4f8ef7", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>저장</button>
            {feedback && <span style={{ fontSize: 13, color: feedback.startsWith("✅") ? "#4caf50" : "#e74c3c" }}>{feedback}</span>}
          </div>
        </div>
      )}

      {/* 매매 목록 */}
      {view === "list" && !selected && (
        trades.length === 0
          ? <div style={{ textAlign: "center", color: "#555", marginTop: 40 }}>매매 기록 없음</div>
          : <div style={{ display: "grid", gap: 8 }}>
            {trades.map(t => (
              <div key={t.id} onClick={() => { setSelected(t); setView("detail"); }}
                style={{ background: "#1a1d27", border: "1px solid #2a2d3a", borderRadius: 10, padding: "12px 16px", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#4f8ef7"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2d3a"}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{t.stock}</span>
                  <span style={{ fontSize: 12, color: "#666" }}>{t.date}</span>
                  {t.technique && <span style={{ background: "#2a2d3a", fontSize: 11, padding: "2px 7px", borderRadius: 4, color: "#aaa" }}>{t.technique}</span>}
                  <span style={{ marginLeft: "auto", fontWeight: 700, color: pnlColor(parseFloat(t.pnlRate)) }}>
                    {t.pnlRate > 0 ? "+" : ""}{t.pnlRate}%
                  </span>
                </div>
                {t.reason && <div style={{ marginTop: 5, fontSize: 12, color: "#666" }}>{t.reason.slice(0, 60)}...</div>}
              </div>
            ))}
          </div>
      )}

      {/* 매매 상세 */}
      {view === "detail" && selected && (
        <div>
          <button onClick={() => { setView("list"); setSelected(null); }}
            style={{ background: "none", border: "none", color: "#4f8ef7", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>← 목록</button>
          <div style={{ background: "#1a1d27", borderRadius: 10, border: "1px solid #2a2d3a", padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{selected.stock}</span>
              <span style={{ fontSize: 13, color: "#666" }}>{selected.date}</span>
              {selected.technique && <span style={{ background: "#2a2d3a", fontSize: 12, padding: "2px 8px", borderRadius: 4, color: "#aaa" }}>{selected.technique}</span>}
              <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 700, color: pnlColor(parseFloat(selected.pnlRate)) }}>
                {selected.pnlRate > 0 ? "+" : ""}{selected.pnlRate}%
              </span>
              <button onClick={() => setTrades(p => p.filter(t => t.id !== selected.id)) || setView("list")}
                style={{ padding: "4px 10px", background: "#3a1a1a", border: "none", color: "#e74c3c", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>삭제</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
              {[["매수가", selected.buyPrice], ["매도가", selected.sellPrice], ["수익률", `${selected.pnlRate}%`],
                ["실현손익", selected.pnl], ["매입금액", selected.amount]].map(([l, v]) => (
                <div key={l} style={{ background: "#13151f", borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 11, color: "#555" }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: l === "수익률" || l === "실현손익" ? pnlColor(parseFloat(v)) : "#ddd" }}>{v || "-"}</div>
                </div>
              ))}
            </div>
            {selected.reason && <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: "#555", marginBottom: 3 }}>매매 이유</div><div style={{ background: "#13151f", borderRadius: 6, padding: 10, fontSize: 13, color: "#ddd", lineHeight: 1.6 }}>{selected.reason}</div></div>}
            {selected.memo && <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: "#555", marginBottom: 3 }}>메모</div><div style={{ background: "#13151f", borderRadius: 6, padding: 10, fontSize: 13, color: "#ddd" }}>{selected.memo}</div></div>}
            {selected.chartImg && <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: "#555", marginBottom: 3 }}>차트</div><img src={`data:image/png;base64,${selected.chartImg}`} alt="chart" style={{ maxWidth: "100%", borderRadius: 6 }} /></div>}
            {selected.aiAnalysis && (
              <div><div style={{ fontSize: 11, color: "#555", marginBottom: 3 }}>🤖 AI 분석</div>
                <div style={{ background: "#1a1330", border: "1px solid #8e44ad", borderRadius: 8, padding: 12, fontSize: 13, color: "#ddd", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{selected.aiAnalysis}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 통계 탭 ====================
function StatsTab({ trades }) {
  if (trades.length === 0) return <div style={{ textAlign: "center", color: "#555", marginTop: 40 }}>매매 데이터 없음</div>;

  const total = trades.length;
  const wins = trades.filter(t => parseFloat(t.pnlRate) > 0).length;
  const totalPnl = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  const avgRate = (trades.reduce((s, t) => s + (parseFloat(t.pnlRate) || 0), 0) / total).toFixed(2);

  const byTech = {};
  trades.forEach(t => {
    const k = t.technique || "미분류";
    if (!byTech[k]) byTech[k] = { total: 0, wins: 0, pnl: 0 };
    byTech[k].total++;
    if (parseFloat(t.pnlRate) > 0) byTech[k].wins++;
    byTech[k].pnl += parseFloat(t.pnl) || 0;
  });

  const card = (label, value, color = "#ddd") => (
    <div style={{ background: "#1a1d27", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );

  return (
    <div style={{ color: "#e0e0e0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
        {card("총 매매", total)}
        {card("승률", `${((wins/total)*100).toFixed(1)}%`, wins/total >= 0.5 ? "#4caf50" : "#e74c3c")}
        {card("총 손익", totalPnl.toLocaleString(), pnlColor(totalPnl))}
        {card("평균 수익률", `${avgRate}%`, pnlColor(parseFloat(avgRate)))}
      </div>
      <div style={{ background: "#1a1d27", borderRadius: 10, border: "1px solid #2a2d3a", padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>기법별 통계</div>
        {Object.entries(byTech).map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #2a2d3a" }}>
            <span style={{ width: 120, fontSize: 13 }}>{k}</span>
            <span style={{ fontSize: 12, color: "#777" }}>{v.total}건</span>
            <span style={{ fontSize: 12, color: v.wins/v.total >= 0.5 ? "#4caf50" : "#e74c3c" }}>승률 {((v.wins/v.total)*100).toFixed(0)}%</span>
            <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: pnlColor(v.pnl) }}>{v.pnl.toLocaleString()}원</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== 메인 앱 ====================
export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [techniques] = useState(() => { try { return JSON.parse(localStorage.getItem("techniques_v1") || "[]"); } catch { return []; } });
  const [trades] = useState(() => { try { return JSON.parse(localStorage.getItem("trades_v1") || "[]"); } catch { return []; } });

  return (
    <div style={{ fontFamily: "sans-serif", background: "#0f1117", minHeight: "100vh", color: "#e0e0e0" }}>
      {/* 헤더 */}
      <div style={{ background: "#1a1d27", borderBottom: "1px solid #2a2d3a", padding: "0 20px", display: "flex", alignItems: "center", gap: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", padding: "14px 0", marginRight: 20 }}>📈 매매 시스템</span>
        {TABS.map((t, i) => (
          <button key={i} onClick={() => setActiveTab(i)}
            style={{ padding: "14px 20px", background: "none", border: "none", borderBottom: activeTab === i ? "2px solid #4f8ef7" : "2px solid transparent",
              color: activeTab === i ? "#fff" : "#666", cursor: "pointer", fontSize: 14, fontWeight: activeTab === i ? 600 : 400 }}>
            {t}
          </button>
        ))}
      </div>
      <div style={{ padding: 20, maxWidth: 960, margin: "0 auto" }}>
        {activeTab === 0 && <LectureTab />}
        {activeTab === 1 && <JournalTab techniques={techniques} />}
        {activeTab === 2 && <StatsTab trades={trades} />}
      </div>
    </div>
  );
}