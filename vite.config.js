import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 로컬 개발(npm run dev)용 /api/claude 중계 — 배포에서는 Vercel 서버 함수(api/claude.js)가 처리.
// 키는 로컬 .env의 ANTHROPIC_API_KEY(없으면 기존 VITE_ANTHROPIC_KEY)에서 읽고 브라우저 번들에는 넣지 않는다.
const devApi = (env) => ({
  name: 'dev-api',
  configureServer(server) {
    server.middlewares.use('/api/claude', async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_KEY || '' },
        body: Buffer.concat(chunks),
      });
      res.statusCode = r.status;
      res.setHeader('content-type', r.headers.get('content-type') || 'application/json');
      res.end(await r.text());
    });
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return { plugins: [react(), devApi(env)] }
})
