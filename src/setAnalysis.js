// 같은 날·같은 종목 매매를 '세트'로 묶어 한 번에 분석 — 프롬프트 생성/응답 파싱
// React 비의존 순수 모듈: 앱(App.jsx)과 일괄분석 스크립트(scripts/backfill_sets.mjs)가 같은 프롬프트를 쓰도록 공용화
//
// 프롬프트 캐싱 구조: system(고정) → [고정 블록: 강의록 전체·실전강의·차트규칙·출력형식](cache_control) → 이미지 → [세트별 가변 블록]
// 고정 블록은 매 호출 바이트 단위로 같아야 캐시가 적중하므로, 세트마다 달라지는 내용(기법별 규칙·관련 강의 ID·시세·피드백)은 전부 가변 블록에 둔다.

// 매매 기법(카테고리) 기본 목록 — 앱 선택지와 세트 분석의 '놓친 기법 자리' 기법명 공용
export const TRADE_CATEGORIES = [
  "상따", "양봉종배", "음봉매매-시초", "음봉매매-종배", "상한가하락시작-시초", "장중매매-돌파", "장중매매-눌림지지",
  "투매-시초", "투매-종가", "투경해제", "단기과열", "무증매매", "악재매매", "기타",
];

// 놓친 기법 자리(AI 제안) — 세트 분석 텍스트 끝 숨김 마커로 저장(별도 컬럼 불필요). LEC 마커보다 앞에 둔다
const MISSED_RE = /\n?<!--MISSED:([^>]*)-->/;
export const withMissed = (text, missed) => (missed?.length ? `${text}\n<!--MISSED:${encodeURIComponent(JSON.stringify(missed))}-->` : text);
export const parseMissed = (s) => { const m = s && s.match(MISSED_RE); if (!m) return []; try { return JSON.parse(decodeURIComponent(m[1])); } catch { return []; } };
export const stripMissed = (s) => (s ? s.replace(MISSED_RE, "") : s);
// '＋ 관망 기록으로 추가'로 만든 기록의 매매이유 머리말(사용자가 이유를 고쳐 쓰면 일반 관망 기록으로 취급)
export const AI_MISSED_PREFIX = "[놓친 자리 · AI 제안]";
const AI_MISSED_RE = /^\s*\[놓친 자리 · AI 제안\]/;

export const CHART_ANGLE_NOTE = "각도(°) 주석(예: 57.42°(6.58%))의 앞 숫자는 추세선 기울기일 뿐 등락률이 아니다 — 괄호 안 %만 가격 변동폭 주석이다. 각도 값을 수익률·등락률로 읽지 말 것.";
export const CHART_TF_NOTE = "봉 주기: 분석 전에 하단 시간 눈금 사이 캔들 수를 세어 몇 분봉인지 판별하고(분봉은 1분·3분·5분봉 중 하나뿐 — 2분봉 등 다른 주기는 없으니 계산값이 사이에 걸리면 가까운 쪽으로, 일봉이면 일봉), 차트 분석 첫 줄에 '○분봉(근거)'로 명시한 뒤 이후 타이밍은 이 봉 주기 기준으로 서술. 셀 때는 눈금 간격이 일정한 구간을 쓰고, 날짜 경계(빨간 세로선) 부근이나 15:30 전후(정규장→NXT 전환)처럼 간격이 불규칙한 구간은 피할 것. 확실하지 않으면 '추정'으로 표기.";

export const SET_SYSTEM = "주식 매매 분석 전문가. 핵심만 간결하게. 분석은 반드시 [강의록 DB]·[실전 강의] 내용에 근거하고, 강의록에 없는 내용을 일반론으로 단정하지 않는다. 차트 이미지가 없으면 차트 관련 내용을 지어내지 않는다. [중요] '정답매매'는 사용자가 실제 실행한 매매가 아닌, 해당 기법 기준으로 올바르게 했어야 할 이상적 시나리오다. 절대 실제 매매 내용을 정답매매로 제시하지 않는다. 같은 날 여러 기법으로 나뉜 기록은 기법별로 분리해 평가하고 서로의 손익·구간을 섞지 않는다.";

const CHART_RULES = [
  "차트 하단 가로축 라벨 해석: 글씨 굵기(볼드 여부)로 구분하지 말 것 - 이미지에서 굵기 구분은 신뢰할 수 없다. 대신 '/' 포함 여부로 구분: '/'가 있는 라벨(예: 05/21, 05/22)은 날짜이고, '/' 없이 숫자만 있는 라벨(예: 10, 11, 12, 13, 14)은 시간(시 단위)이다. 차트는 분봉 등 타임프레임 기준으로 그려지므로 '/' 없는 숫자는 항상 시간이며 '~일'(날짜)로 해석하면 안 된다.",
  "차트는 반드시 좌→우 시간순으로 읽을 것. 왼쪽 캔들이 과거, 오른쪽 캔들이 현재/미래다. 차트 왼쪽에 있는 과거 고점·저점·급등락은 현재 매매의 직접 원인이 아닌 '사전 맥락'으로만 참고할 것.",
  "차트에 표시된 도형 해석: 파란/빨간 오각형(B/S 글자)은 사용자가 실제로 체결한 매수(B)/매도(S) 지점이다. B 마커가 차트 오른쪽에 있다면 왼쪽의 모든 캔들은 '매수 이전 역사'이며 그 구간의 가격 움직임을 현재 매매의 근거로 직접 연결하지 말 것. 분석의 기준점은 B 마커 위치이고, B 이전 차트는 진입 맥락 파악용으로만 활용할 것. '세력의 매수/매도 물량 출현' 같은 추측성 해석을 붙이지 말 것. 사각형(네모) 표시는 정답매매의 이상적 매수(진입) 타점, 동그라미(원/타원) 표시는 정답매매의 이상적 매도(청산) 타점이다. 차트에 네모·동그라미가 여러 개 있을 수 있으며, 개수에 상관없이 보이는 것을 빠짐없이 모두 확인하여 각각의 위치와 가격대를 파악할 것. 실제 매매(B/S 마커)와 정답매매(네모/동그라미)의 위치·가격을 하나씩 비교해 진입·청산 타이밍 차이를 분석에 활용하고, 도형이 보이지 않으면 언급하지 말 것.",
  "차트에 표시된 % 수치(예: -52.87%, +49.40% 등)는 키움 HTS가 자동 표시하는 '가격 변동폭 주석'이다. 위치와 무관하게 이 수치는 절대 현재 매매의 손익이 아니다. 실제 매매 손익은 오직 기록된 매수가·매도가·실현손익과 B/S 마커 위치로만 판단할 것.",
  CHART_ANGLE_NOTE,
  CHART_TF_NOTE,
  "'최고 OO,OOO', '최저 OO,OOO' 옆의 가격은 그 구간의 일중 고가/저가 자동주석일 뿐 매매가가 아니다. 또한 차트에 그어진 수평선(파란/회색 가로선, 커서선, 기준선)의 가격도 매매가나 상한가가 아니다 — 임의의 참조선이므로 그 값을 상한가·매수가·매도가로 지어내지 말 것. 실제 매수가·매도가는 기록된 값이 유일한 근거다.",
  "[중요] '최고 OO,OOO (-40.54%, 13:21)'처럼 최고/최저 주석 옆의 %, 그리고 우측 상단의 HC/LC 값은 '그 고점(또는 저점)에서 차트 맨 오른쪽 현재가(가장 최근 캔들, 보통 당일)까지의 변동률'이다. 이 %는 여러 거래일에 걸친 누적 수치일 수 있다. 특정 하루(전일)의 봉 모양·양봉/음봉 여부·윗꼬리·마감 강도를 판단할 때는 이 누적 %를 쓰지 말고, 그 날짜 구간 안에서의 시가→종가→고가→저가 캔들 형태만 보고 판단할 것.",
  "분석 대상일의 시가가 그 직전에 표시된 캔들들의 가격대보다 위/아래에서 시작했다면 갭상승/갭하락으로 언급 가능하나, 차트에 직접 보이지 않는 사실을 추정해서 단정하지 말 것.",
  "가로축에서 MM/DD 형식의 날짜 라벨이 두 개 이상 보이면 차트에 두 개 이상의 거래일이 함께 표시된 것이다. 가장 오른쪽 날짜가 당일, 그 왼쪽이 전일(또는 그 이전)이다. 전일 흐름과 당일 흐름을 구분하여 언급할 것.",
  "차트 중간을 세로로 가로지르는 빨간(붉은) 수직선은 '날짜(거래일)가 바뀌는 경계'다. 이 선의 왼쪽은 전일(또는 그 이전) 장, 오른쪽은 당일 장이다.",
  "정규장 시간은 09:00~15:30이다. 차트 시간축에 09:00 이전(프리마켓, 보통 08:00~) 또는 15:30 이후(애프터마켓, ~20:00) 캔들이 보이면 그건 NXT(넥스트레이드) 연장거래 시간대다. 매매가 정규장 시간인지 연장 시간인지 구분해 해석할 것.",
  "캔들이 특정 가격대(가격제한폭 상단)에 도달한 뒤 그 가격에서 수평으로 일자로 머물러 있는 구간은 상한가(가격제한폭 도달)에 잠겨 있는 상태다. 장 마감 시점까지 그 상단 가격에 수평으로 붙어 있으면 '상한가로 마감'한 것으로 해석할 것.",
  "교본 차트(동일 날짜·동일 종목 강사 실제 매매)가 첨부된 경우 그 B/S는 강사의 실제 진입/청산이자 곧 정답매매(모범 답안)다 — 교본 차트엔 네모/동그라미가 없고 강사 B/S 자체가 정답이다. 교본 차트가 여러 장이면 차트 상단에 인쇄된 종목명으로 해당 종목 차트만 비교 대상으로 삼을 것.",
];

const ANALYSIS_GUIDE =
  `[세트 분석 지침]\n` +
  `- 입력은 같은 날·같은 종목 매매를 키움 0328 기준으로 기법별로 나눈 기록 T1..Tn이다. 각 기록의 매수가·매도가는 그 기법 구간의 평균가, 매입금액·실현손익은 그 구간의 확정치다(체결 시각 없음). 기록이 1개면 단건 분석이다.\n` +
  `- 1단계(배정): 내 매매일지 차트의 B/S 마커를 모두 찾아 각 마커를 어느 기록(T)에 속하는지 배정하라. 근거: 한 기록에 배정된 마커 가격들 사이에 그 기록의 평균매수가/평균매도가가 있어야 함, 매입금액÷평균매수가=수량, 매매이유의 시간·상황·금액(괄호 숫자=만원) 묘사, 같은 기록의 B는 S보다 앞. 당일 이외 날짜 구간의 마커는 제외. 애매하면 conf를 low로.\n` +
  `- 2단계(순서): 배정 결과로 당일 체결 순서를 복원하라(sequence).\n` +
  `- 3단계(놓친 자리): 차트·KRX 시세·교본(강사 B/S)·강의록 기준으로, 이 종목·날짜에 강의록 기법상 진입했어야 하는데 기록(T)에 없는 자리가 있으면 찾아라. 차트의 네모(정답 매수) 표시, 교본 B 중 내 기록에 없는 구간, 강의록 트리거가 명확히 성립한 구간이 근거다. 이미 기록된 기법·구간과 겹치면 제외, 근거가 약하면 넣지 말 것(최대 3개, 없으면 빈 배열). 기법명은 [기법 목록] 중에서 고를 것.\n` +
  `- 기법 분리 원칙: 각 T 섹션은 그 T에 배정된 마커·가격·금액·매매이유만 근거로 하고, 다른 T의 손익·구간을 합치거나 혼동하지 말 것. T 사이의 연결(전환·재진입·추가매수·청산 이어짐)은 SET 섹션에서만 다룬다.\n` +
  `- 관망 기록(매수가·매도가 없음)은 실제 진입이 없으므로 체결 손익·손절 실행을 논하지 말고, 관망 판단이 옳았는지/진입했어야 하는 자리였는지/진입했다면 정답매매가 무엇이었는지 중심으로 쓸 것.\n` +
  `- 'AI 제안으로 추가된 관망 기록'은 매매이유가 사용자의 판단이 아니라 이전 분석의 제안이다. 사용자가 그 자리를 보고도 안 들어갔다고 단정하거나 그 문장을 사용자 근거로 인용하지 말고, 그 자리를 다음에 잡기 위한 체크포인트(트리거·확인 신호·진입 조건·손절 기준)와 정답 시나리오 중심으로 쓸 것. 사용자가 이유를 직접 고쳐 쓴 경우(표시 없음)는 일반 관망 기록으로 다룬다.\n` +
  `- [우선순위 낮음] 동시호가(장 시작·마감 단일가)에서 상한가로 들어가는 진입(동시호가 상따·쩜상 예상 시 상한가 매수 등, 11·32·49·50강의 해당 부분)은 요즘 거의 나오지 않는다. 기법 매칭·정답매매 시나리오·놓친 자리·추천 강의에서 1순위로 고려하지 말고, 기록·매매이유가 명백히 그 진입일 때만 다룰 것. (27강의 '동시호가 투매가 나온 양봉' 매매는 별개 패턴이라 해당 없음)\n` +
  `- 각 T의 [우선 참고 강의록 ID]를 먼저 보되, 강의록 DB 전체에서 더 맞는 내용이 있으면 함께 인용할 것. 우선 참고가 없으면 '직접 매칭 강의록 없음'을 명시할 것.\n\n` +
  `[출력 형식] 구분자 줄(<<<…>>>)은 정확히 그대로, 다른 텍스트 없이 한 줄로 쓸 것:\n` +
  `<<<SET>>>\n` +
  `(기록이 2개 이상일 때) ## 📦 하루 포지션 흐름\n` +
  `- 체결 순서: T? 기법 → T? 기법 … (마커 근거 한 줄)\n` +
  `- 기법 간 전환·재진입·추가매수·청산 연결이 강의록 기준으로 적절했는지\n` +
  `- 세트 합산(매입금액·실현손익)과 하루 전체의 핵심 교훈 1~2줄\n` +
  `(놓친 자리가 있으면 기록 수와 무관하게) ### 🔍 놓친 기법 자리 — 자리마다 '기법 · 시간·가격 · 근거(강의록/교본) · 진입했다면 정답 시나리오' 한두 줄\n` +
  `(기록이 1개이고 놓친 자리도 없으면 이 블록은 '-' 한 줄만)\n` +
  `<<<T1>>>\n` +
  `## 1. 기법 매칭 — 기록의 매수가/매도가/수익률을 참고해 이 기법 구간이 강의록의 진입조건/포지션/주의사항에 얼마나 부합하는지(강의록 근거 인용). 관망이면 관망 판단이 옳았는지\n` +
  `## 2. 차트 분석 — 첫 줄에 봉 주기. 이 T에 배정된 B/S 위치·시간대가 기법의 트리거·패턴과 일치하는지\n` +
  `## 3. 정답매매 — 강의록 기법 기준 이상적 진입/손절/익절 시나리오(실제 매매 아님). 금액은 괄호 숫자(만원) 표기, 퍼센트 금지\n` +
  `## 4. 잘된 점 / 개선할 점 (관망이면 관망 판단 복기: 놓친 기회/잘 피한 자리, 다음 결정 기준)\n` +
  `## 5. 교본 B/S 비교(동일 종목 교본이 있을 때: 진입 시점·청산 시점·가격대 차이와 강사 카톡 근거) / 교본이 없으면 동일 날짜 실전매매와의 연관성\n` +
  `## 6. 과거 유사 매매 비교 — 매매이유 워딩이 얼마나 비슷한지\n` +
  `<<<T2>>>\n(T2도 같은 6항목, 기록 수만큼 반복)\n` +
  `<<<DATA>>>\n` +
  "```json\n" +
  `{"sequence":["T1"],"markers":[{"chart":1,"type":"B","time":"09:00","price":0,"trade":"T1","conf":"high"}],"lecture":{"SET":0,"T1":0},"similar":{"T1":[]},"missed":[{"technique":"기법명","time":"09:05","price":0,"lecture":0,"reason":"근거 한두 줄","conf":"high|mid"}]}\n` +
  "```\n" +
  `(lecture: 각 T와 세트 전체에 가장 적합한 강의록 1개의 ID — 강의록 DB의 [ID:...] 중에서. similar: 각 T와 가장 유사한 과거 매매 ID 최대 5개 — [과거 유사 매매]의 [ID:...] 중에서. missed: 3단계 놓친 자리, lecture는 근거 강의록 ID)\n\n` +
  `[기법 목록] ${TRADE_CATEGORIES.filter(c => c !== "기타").join(", ")} (해당 없으면 기타)`;

const lectureLine = (t, i) =>
  `[ID:${t.id}] ${i < 51 ? `${i + 1}강 ` : ""}[${t.name}] 카테고리:${t.category || "-"} / 타임프레임:${t.timeframe || "-"}\n` +
  `- 매수조건:${t.entry?.condition || "-"} / 포지션:${t.entry?.position || "-"} / 주의:${t.entry?.caution || "-"}\n` +
  `- 패턴(진입전→트리거→진입후): ${t.pattern?.before || "-"} → ${t.pattern?.trigger || "-"} → ${t.pattern?.after || "-"}\n` +
  `- 청산(수익/손실): ${t.exit?.profit || "-"} / ${t.exit?.loss || "-"}` +
  (t.rawInput ? `\n- 원문: ${t.rawInput.slice(0, 500)}` : "");

// 캐시되는 고정 블록. techniques는 앱 표시 순서(=강 번호), lectureLives는 '강의' 분류 실전매매
export const buildStaticText = ({ techniques, lectureLives }) =>
  `[강의록 DB — 전체 ${techniques.length}개. 분석의 1차 근거]\n${techniques.map(lectureLine).join("\n\n")}\n\n` +
  `[실전 강의 — 강사가 남긴 상세 실전 강의. 강의록과 동등하게 근거로 활용]\n` +
  `${lectureLives.length ? lectureLives.map(t => `[${t.title || t.stock || "실전강의"}]${t.date ? ` (${t.date})` : ""}\n${(t.textContent || "").slice(0, 1800)}`).join("\n---\n") : "(없음)"}\n\n` +
  `[차트 판독 규칙]\n${CHART_RULES.map(r => `- ${r}`).join("\n")}\n\n` +
  `[표기 규칙] 매매이유에서 괄호 안 숫자는 만원 단위임. 예: (+50)=+50만원 수익, (1000)=1000만원 매수금액, (-30)=-30만원 손실.\n\n` +
  ANALYSIS_GUIDE;

// 기법별 추가 규칙(세트에 해당 기법이 있을 때만 가변 블록에 포함)
const techRule = (tech) => {
  if (tech === "상따") return "[상따 기법 규칙] 전일 차트는 상한가로 마감한 것이다. 상따는 '전일 상한가에서 매수'하는 기법이므로 기록된 매수가 = 전일 상한가 진입가로 간주할 것. B 마커가 보이지 않아도 상한가 매수로 전제하고, '최저' 주석 가격이 매수가와 비슷해도 '저점 선매수'나 '상따 원칙 위반'으로 재해석하지 말 것. 당일은 상한가 다음날로서 갭상승 또는 보합 출발 흐름을 중점 분석. 당일 갭하락 출발은 '상한가하락시작' 기법이므로 혼동하지 말 것.";
  if (tech?.startsWith("상한가하락시작")) return "[상한가하락시작 기법 규칙] 전일 차트는 상한가로 마감한 것이다. 당일은 상한가 다음날이나 갭하락 또는 약세 출발하는 흐름이다. 전일 상한가 마감 후 당일 하락 출발 시점의 매매 맥락을 중점 분석할 것.";
  if (tech === "투경해제") return "[투경해제 차트 규칙] 일봉 차트를 쓰는 경우가 있으며, 이때는 가로축 라벨 전체가 연/월 단위(예: 2026/03, 04, 05)이므로 시간 규칙이 아닌 연/월 단위로 해석할 것.";
  return "";
};

const fmt = (v) => (v === "" || v == null ? "-" : String(v));

// KRX 시세(+NXT 보정) 블록 — market_data 행의 data({summary, bars, nxt}) → 분석 프롬프트용 텍스트(앱·일괄분석 공용)
export const buildMarketSection = (md) => {
  if (!md?.summary) return "";
  const barsTxt = (md.bars || []).map(b => `${b.date} 시${b.o} 고${b.h} 저${b.l} 종${b.c}${b.cndl ? ` ${b.cndl}(몸통${b.body}%·윗꼬리${b.upw}%·아랫꼬리${b.loww}%)` : ""} (등락 ${b.rate ?? "-"}%, 갭 ${b.gap ?? "-"}%, 장중고점 ${b.hrate ?? "-"}%${b.upper ? ", 상한가마감" : ""}${b.listing ? `, ※상장당일: 등락/갭/고점은 전일종가가 아닌 공모가 ${b.base?.toLocaleString?.() ?? b.base}원 대비` : ""})`).join("\n");
  const hasNxt = md.nxt && !md.nxt.none;
  // 키움 조회로 'NXT 미거래 종목'이 확인된 경우(사유 기록됨·NXT 개장 전 제외) → KRX 수치에 NXT 왜곡이 없음
  const noNxt = md.nxt?.none && md.nxt.why && md.nxt.why !== "NXT 개장 전";
  return `[KRX 정규장 실제 시세 - 확정 사실]\n${md.summary}\n[일별 시세]\n${barsTxt}\n` +
    `※ 위는 한국거래소 '정규장(09:00~15:30)' 실제 데이터다. 전일 상한가 마감 여부, 지수 국면, 정규장 기준 종가 등락률은 이 수치를 확정 사실로 쓰고, 차트에서 읽은 값이 다르면 이 데이터를 따를 것.\n` +
    (noNxt
      ? `※ [NXT 미거래 확인] 이 종목은 해당일 NXT(넥스트레이드)에서 거래되지 않았다(키움 조회로 확인). 따라서 위 KRX 갭·등락은 전일 종가 이후 실제 흐름 그대로이며 NXT 애프터·프리마켓에 의한 왜곡이 없다. 차트에 정규장 밖 캔들이 보이면 NXT가 아니라 KRX 시간외 거래(시간외 단일가 등)로 해석할 것.\n`
      : hasNxt
      ? `※ [NXT 보정 우선] 요약의 [NXT 보정] 줄은 키움 NXT(넥스트레이드) 실제 시세다. KRX '갭'·'등락'은 전일 애프터마켓(15:30~20:00)·당일 프리마켓(08:00~08:50) 움직임을 반영하지 못하므로, 시초 갭·출발 강도·전일 마감 이후 흐름은 '실질 갭'과 NXT 세션 수치를 기준으로 판단할 것(KRX 갭이 크게 나와도 NXT에서 이미 올랐다면 실질적으론 갭이 작거나 갭하락일 수 있음). NXT 시간대 매매는 NXT 세션 고저를 기준으로 평가.\n`
      : `※ [NXT 예외] 차트에 09:00 이전/15:30 이후 캔들이 보이면 NXT 연장거래이며 위 KRX 데이터에 포함되지 않는다. 그 구간의 시가·갭·고저는 차트를 우선해서 해석할 것(NXT 미거래 종목이거나 보정 데이터 없음).\n`) +
    `※ 손익은 기록된 매수가·매도가·실현손익 기준.\n\n`;
};

// 세트별 가변 블록. items: [{label, trade, observe, relatedIds}], charts: [{n, labels}] (중복 제거된 내 차트), liveImgCount: 교본/실전 이미지 수
export const buildSetVariableText = ({ stock, date, dayLabel, items, charts, liveImgCount, liveImgIsSameStock, marketSection, liveSection, sameStockLiveNote, pastTrades, correctionsCtx }) => {
  const rules = [...new Set(items.map(it => techRule(it.trade.technique)).filter(Boolean))];
  const chartNote = charts.length
    ? charts.map(c => `- 차트${c.n} = 내 매매일지 차트 (${c.labels.join("·")} 공용)`).join("\n")
    : "- 내 매매일지 차트 없음 → 차트 기반 분석·마커 배정은 하지 말고 '차트 없음'으로 명시(markers는 빈 배열)";
  const liveNote = liveImgCount
    ? `\n- 이후 ${liveImgCount}장 = ${liveImgIsSameStock ? `교본 차트(동일 날짜·동일 종목 '${stock}' 강사 실제 매매 = 정답)` : "동일 날짜 실전매매 관련 이미지"}`
    : "";
  return (
    `[세트] 종목:${stock} 날짜:${date}${dayLabel} — 기록 ${items.length}건 (키움 0328 기준 기법별 분리)\n` +
    items.map(({ label, trade: t, observe, relatedIds }) =>
      `[${label}] id:${t.id} 기법:${t.technique || "미지정"}${observe ? " (관망·미진입)" : ""} 평균매수가:${fmt(t.buyPrice)} 평균매도가:${fmt(t.sellPrice)} 매입금액:${fmt(t.amount)} 실현손익:${fmt(t.pnl)} 수익률:${fmt(t.pnlRate)}%\n` +
      `  우선 참고 강의록 ID: ${relatedIds.length ? relatedIds.join(", ") : "(직접 매칭 없음)"}\n` +
      `  매매이유${AI_MISSED_RE.test(t.reason || "") ? "(⚠️ AI 제안으로 추가된 관망 기록 — 사용자 작성 아님)" : ""}: ${t.reason || "(없음)"}\n` +
      (t.memo ? `  메모: ${t.memo}\n` : "")
    ).join("\n") + "\n\n" +
    (rules.length ? `[기법별 추가 규칙]\n${rules.join("\n")}\n\n` : "") +
    marketSection +
    `[첨부 이미지]\n${chartNote}${liveNote}\n이미지에서 실제로 확인 가능한 내용만 사용할 것.\n\n` +
    `[동일 날짜(${date}) 실전매매 기록]\n${liveSection || "(없음)"}\n\n` +
    (sameStockLiveNote ? `[동일 종목·동일 날짜 교본(실전매매) - B/S 비교 대상, 강사 실제 매매]\n${sameStockLiveNote}\n\n` : "") +
    `[과거 유사 매매 - 매매이유 원문]\n${pastTrades || "(없음)"}\n\n` +
    (correctionsCtx || "") +
    `위 [세트 분석 지침]과 [출력 형식]대로 ${items.map(i => i.label).join(", ")} 모두 분석하라.`
  );
};

// 응답 파싱: <<<SET>>> / <<<Tn>>> / <<<DATA>>> 구분자. 단건인데 구분자가 없으면 전체를 T1로 간주
export const parseSetResult = (text, labels) => {
  const parts = {};
  const re = /^\s*<<<(SET|T\d+|DATA)>>>\s*$/gm;
  const hits = [...String(text).matchAll(re)];
  hits.forEach((m, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
    parts[m[1]] = text.slice(m.index + m[0].length, end).trim();
  });
  const dataSrc = parts.DATA ?? text;
  let data;
  const jm = [...dataSrc.matchAll(/```json\s*([\s\S]*?)```/g)];
  try { data = JSON.parse(jm.length ? jm[jm.length - 1][1] : (dataSrc.match(/\{[\s\S]*\}\s*$/) || ["{}"])[0]); } catch { data = {}; }
  if (!hits.length) {
    if (labels.length !== 1) throw new Error("세트 분석 응답 형식(<<<T1>>> 구분자) 파싱 실패 — 다시 시도해 주세요.");
    parts.T1 = String(text).replace(/```json[\s\S]*?```\s*$/, "").trim();
  }
  const missing = labels.filter(l => !parts[l]);
  if (missing.length) throw new Error(`세트 분석 응답에 ${missing.join(", ")} 섹션이 없습니다 — 다시 시도해 주세요.`);
  const setText = parts.SET && parts.SET.replace(/^-\s*$/, "").trim();
  return {
    setText: setText || "",
    perTrade: Object.fromEntries(labels.map(l => [l, parts[l]])),
    sequence: Array.isArray(data.sequence) ? data.sequence.filter(l => labels.includes(l)) : [],
    markers: Array.isArray(data.markers) ? data.markers : [],
    lecture: data.lecture && typeof data.lecture === "object" ? data.lecture : {},
    similar: data.similar && typeof data.similar === "object" ? data.similar : {},
    missed: Array.isArray(data.missed) ? data.missed.filter(m => m && typeof m.technique === "string" && m.technique.trim()).slice(0, 3) : [],
  };
};

// ── 놓친 자리 → 관망 기록: 재분석 없이 즉시 카드 + 필요할 때 '추가한 관망만' 심화 분석 ──
// 1) 빠른 카드(AI 호출 없음): 세트 분석이 이미 만든 제안(기법·시점·가격·근거·강의)과 SET 본문의 해당 줄을 그대로 옮김
export const MISSED_CARD_HEAD = "## 🔍 놓친 자리 — AI 제안 요약";
export const isMissedCard = (s) => String(s || "").trim().startsWith(MISSED_CARD_HEAD);
export const isAiMissedReason = (reason) => AI_MISSED_RE.test(reason || "");

// SET 본문의 '🔍 놓친 기법 자리' 블록에서 이 제안(기법명·시간)에 해당하는 줄
const missedLinesOf = (setText, m) => {
  const after = String(setText || "").split(/^#{2,4}[^\n]*놓친 기법 자리[^\n]*$/m)[1];
  if (!after) return [];
  const sec = after.split(/^#{1,3}\s/m)[0];
  const keys = [m.technique, m.time].filter(Boolean);
  return sec.split("\n").map(l => l.trim()).filter(l => l && keys.some(k => l.includes(k))).slice(0, 3);
};

export const buildMissedCard = (m, { setText, lectureName } = {}) => {
  const lines = missedLinesOf(setText, m);
  return [
    MISSED_CARD_HEAD,
    `- **기법**: ${m.technique}`,
    `- **시점·가격**: ${m.time || "-"}${m.price ? ` · ${Number(m.price).toLocaleString()}원` : ""}${m.conf ? ` (확신 ${m.conf})` : ""}`,
    m.reason ? `- **근거**: ${m.reason}` : "",
    lectureName ? `- **근거 강의**: ${lectureName}` : "",
    lines.length ? `\n**세트 분석 원문**\n${lines.map(l => (l.startsWith("-") ? l : `- ${l}`)).join("\n")}` : "",
    `\n> 세트 분석이 찾은 자리를 그대로 옮긴 요약입니다(추가 비용 없음). 진입 조건·확인 신호·손절 기준·정답 시나리오까지 보려면 세트 패널의 **🔍 심화 분석**을 누르세요 — 추가한 관망 기록만 분석하고 기존 매매 분석은 그대로 둡니다.`,
  ].filter(Boolean).join("\n");
};

// 2) 심화 분석(추가한 AI 제안 관망 기록 여러 건을 한 번에): 강의록은 관련 것만, 기존 세트 분석은 맥락으로
export const lectureSubsetText = (techniques, ids) => {
  const set = new Set(ids.map(Number));
  const lines = techniques.map((t, i) => (set.has(Number(t.id)) ? lectureLine(t, i) : null)).filter(Boolean);
  return lines.length ? lines.join("\n\n") : "(관련 강의록 없음)";
};

export const MISSED_DEEP_SYSTEM = SET_SYSTEM + " 이번 작업은 이전 세트 분석이 찾은 '놓친 기법 자리'를 관망 기록으로 추가한 것들만 깊게 분석하는 것이다. 사용자는 이 자리에서 실제로 진입하지 않았고, 매매이유도 사용자가 쓴 것이 아니다.";

// items: [{label:"O1", trade, sug:{technique,time,price,reason,conf,lecture}}], others: 세트의 나머지 실제 기록(맥락)
export const buildMissedDeepText = ({ stock, date, dayLabel, items, others, setText, lectures, marketSection, chartCount, liveImgCount, sameStockLiveNote }) =>
  `[강의록 — 이 자리들과 관련된 것만]\n${lectures}\n\n` +
  `[차트 판독 규칙]\n${CHART_RULES.map(r => `- ${r}`).join("\n")}\n\n` +
  `[표기 규칙] 괄호 안 숫자는 만원 단위.\n\n` +
  `[세트] 종목:${stock} 날짜:${date}${dayLabel}\n` +
  `[같은 날 실제 기록 — 맥락 참고용, 이번 분석 대상 아님]\n${others.length ? others.map(t => `- 기법:${t.technique || "미지정"}${!String(t.buyPrice ?? "").trim() && !String(t.sellPrice ?? "").trim() ? " (관망)" : ` 평균매수가:${fmt(t.buyPrice)} 평균매도가:${fmt(t.sellPrice)} 실현손익:${fmt(t.pnl)}`} / 이유: ${(t.reason || "-").slice(0, 200)}`).join("\n") : "(없음)"}\n\n` +
  (setText ? `[이전 세트 분석 — 하루 흐름·놓친 자리를 찾은 근거]\n${setText}\n\n` : "") +
  marketSection +
  `[첨부 이미지]\n${chartCount ? `- 처음 ${chartCount}장 = 내 매매일지 차트` : "- 내 매매일지 차트 없음 → 차트 기반 내용은 쓰지 말고 '차트 없음'으로 명시"}` +
  (liveImgCount ? `\n- 이후 ${liveImgCount}장 = 교본 차트(동일 날짜·동일 종목 강사 실제 매매 = 정답)` : "") + "\n\n" +
  (sameStockLiveNote ? `[동일 종목·동일 날짜 교본 - 강사 실제 매매]\n${sameStockLiveNote}\n\n` : "") +
  `[분석 대상 — AI 제안으로 추가한 관망 기록]\n` +
  items.map(({ label, sug }) => `[${label}] 기법:${sug.technique} 제안 시점:${sug.time || "-"} 제안 가격:${sug.price ? Number(sug.price).toLocaleString() : "-"} 확신:${sug.conf || "-"} 근거 강의 ID:${sug.lecture || "-"}\n  제안 근거: ${sug.reason || "-"}`).join("\n") + "\n\n" +
  `[지침]\n- 각 자리를 차트·시세·강의록으로 다시 검증하라. 다시 봤을 때 트리거가 성립하지 않았거나 근거가 약하면 첫 줄에 '⚠️ 재검토: 근거 약함 — (이유)'로 밝히고 짧게 끝낼 것.\n` +
  `- 사용자가 그 자리를 보고도 안 들어갔다고 단정하지 말 것. 실제 매매(T)의 손익을 이 기록에 섞지 말 것.\n\n` +
  `[출력 형식] 구분자 줄은 정확히 그대로 한 줄로:\n` +
  items.map(({ label }) => `<<<${label}>>>`).join("\n(같은 형식)\n") + "\n" +
  `각 섹션:\n## 1. 이 자리의 근거 — 강의록 트리거가 어떻게 성립했는지(강의록 인용), 확신도\n## 2. 차트 분석 — 첫 줄에 봉 주기. 진입 전 흐름→트리거 캔들→이후 흐름\n## 3. 정답매매 시나리오 — 진입가·손절가·익절 구간(금액은 괄호 숫자=만원, 퍼센트 금지)\n## 4. 다음에 잡기 위한 체크포인트 — 트리거·확인 신호·진입 조건·손절 기준을 체크리스트로\n` +
  `위 형식대로 ${items.map(i => i.label).join(", ")} 모두 분석하라.`;

export const parseMissedDeep = (text, labels) => {
  const parts = {};
  const hits = [...String(text).matchAll(/^\s*<<<(O\d+)>>>\s*$/gm)];
  hits.forEach((m, i) => { parts[m[1]] = text.slice(m.index + m[0].length, i + 1 < hits.length ? hits[i + 1].index : text.length).trim(); });
  if (!hits.length && labels.length === 1) parts[labels[0]] = String(text).trim();
  const missing = labels.filter(l => !parts[l]);
  if (missing.length) throw new Error(`심화 분석 응답에 ${missing.join(", ")} 섹션이 없습니다 — 다시 시도해 주세요.`);
  return parts;
};
