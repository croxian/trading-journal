// 환경변수: 붙여넣기로 섞인 앞뒤 공백·줄바꿈 제거(공백이 있으면 키 인증 실패)
export const env = (k) => (process.env[k] || "").trim();

// 서버 함수 공용 인증: Supabase 로그인 세션(access token)을 Supabase에 직접 확인
// (파일명이 _로 시작해 Vercel 라우트로 노출되지 않음)
// SUPABASE_ANON_KEY는 원래 공개용 키 — 비밀이 아님. 데이터 보호는 RLS(로그인 사용자만)로 한다.
const SB_URL = env("SUPABASE_URL") || "https://vbdtrynddjryxcpgpisf.supabase.co";
const SB_ANON = env("SUPABASE_ANON_KEY") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiZHRyeW5kZGpyeXhjcGdwaXNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDI0MDEsImV4cCI6MjA5NTk3ODQwMX0.p3Bs8i-sNz6GodYIXLg1BzdrTxAc9-jB2dZRaOKCW3M";

// 로그인한 사용자면 user 객체, 아니면 null. ALLOWED_EMAILS(콤마 구분)가 있으면 그 이메일만 허용
export async function verifyUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    const allowed = (env("ALLOWED_EMAILS") || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(String(u.email || "").toLowerCase())) return null;
    return u;
  } catch { return null; }
}
