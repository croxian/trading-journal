// Claude API 중계(Vercel 서버 함수) — API 키를 브라우저 JS에 넣지 않기 위해 서버에서만 보관
// 환경변수(Vercel → Settings → Environment Variables): ANTHROPIC_API_KEY, ALLOWED_EMAILS(선택)
// 로그인한 사용자(Supabase 세션)만 호출 가능
import { verifyUser, env } from "./_auth.js";

export const config = { maxDuration: 300 };   // 세트 분석은 길면 4~5분

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: { message: "POST만 허용" } });
  if (!(await verifyUser(req))) return res.status(401).json({ error: { message: "로그인이 필요합니다(세션 만료 시 다시 로그인)" } });
  if (!env("ANTHROPIC_API_KEY")) return res.status(500).json({ error: { message: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다" } });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": env("ANTHROPIC_API_KEY") },
      body: JSON.stringify(req.body),
    });
    res.status(r.status);
    res.setHeader("content-type", r.headers.get("content-type") || "application/json");
    res.send(await r.text());
  } catch (e) {
    res.status(502).json({ error: { message: `Claude 중계 실패: ${e.message}` } });
  }
}
