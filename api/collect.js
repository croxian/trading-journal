// 시세 수집 즉시 실행: GitHub Actions 'market-fetch.yml'을 workflow_dispatch로 바로 시작
// (GitHub 예약 실행은 몇 시간씩 밀려서 정시 실행용) 호출 경로 두 가지:
//  - Vercel 크론(vercel.json, 매일 20시대): Authorization: Bearer CRON_SECRET
//  - 앱의 '시세 지금 수집' 버튼: x-app-pass = APP_PASSWORD
// 환경변수: GH_TOKEN(이 저장소 Actions: Read and write 권한의 fine-grained 토큰), CRON_SECRET, APP_PASSWORD, GH_REPO(선택)
export default async function handler(req, res) {
  const cronOk = !!process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const userOk = !!process.env.APP_PASSWORD && req.headers["x-app-pass"] === process.env.APP_PASSWORD;
  if (!cronOk && !userOk) return res.status(401).json({ error: { message: "접근 암호가 틀렸습니다" } });
  if (!process.env.GH_TOKEN) return res.status(500).json({ error: { message: "서버에 GH_TOKEN이 설정되지 않았습니다" } });
  const repo = process.env.GH_REPO || "croxian/trading-journal";
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/market-fetch.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "trading-journal",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (r.status === 204) return res.status(200).json({ ok: true, by: cronOk ? "cron" : "user" });
    return res.status(502).json({ error: { message: `GitHub ${r.status}: ${(await r.text()).slice(0, 200)}` } });
  } catch (e) {
    return res.status(502).json({ error: { message: `GitHub 호출 실패: ${e.message}` } });
  }
}
