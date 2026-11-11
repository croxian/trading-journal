// 🔒 빌드 결과물 비밀 키 검사 — 브라우저 JS에 비밀이 섞이면 빌드를 실패시켜 배포 자체를 막는다.
// package.json "build"에서 vite build 직후 실행(Vercel 배포 빌드도 동일).
// 막는 것: Anthropic 키, Supabase service_role 키(JWT role), GitHub 토큰, 비밀 환경변수 이름이 값과 함께 박힌 흔적
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.argv[2] || "dist");
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.(js|mjs|html|css|json|map)$/.test(f) && files.push(p); } };
if (!fs.existsSync(DIST)) { console.error(`check-bundle: ${DIST} 없음`); process.exit(1); }
walk(DIST);

const problems = [];
const mask = (s) => `${s.slice(0, 12)}…(${s.length}자)`;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const rel = path.relative(process.cwd(), f);
  for (const m of src.matchAll(/sk-ant-[A-Za-z0-9_-]{16,}/g)) problems.push(`${rel}: Anthropic API 키 ${mask(m[0])}`);
  for (const m of src.matchAll(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})/g)) problems.push(`${rel}: GitHub 토큰 ${mask(m[0])}`);
  for (const m of src.matchAll(/\bsb_secret_[A-Za-z0-9_-]{10,}/g)) problems.push(`${rel}: Supabase 비밀 키(sb_secret) ${mask(m[0])}`);
  // JWT 중 role이 anon이 아닌 것(service_role 등)은 서버 전용
  for (const m of src.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      if (payload.role && payload.role !== "anon") problems.push(`${rel}: Supabase '${payload.role}' 키(JWT) ${mask(m[0])}`);
    } catch { /* JWT 아님 */ }
  }
}

if (problems.length) {
  console.error("\n❌ 빌드 결과물에 비밀 키가 들어 있습니다 — 배포를 중단합니다.");
  problems.forEach(p => console.error("   - " + p));
  console.error("\n비밀 값은 VITE_ 환경변수나 소스 코드에 넣지 말고, 서버 함수(api/*)의 환경변수로만 쓰세요.\n");
  process.exit(1);
}
console.log(`✅ check-bundle: ${files.length}개 파일에 비밀 키 없음`);
