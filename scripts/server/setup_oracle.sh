#!/usr/bin/env bash
# 고정 IP 서버(오라클 클라우드 등)에서 시세 수집 + NXT 보정(키움 REST API)을 매일 20:30 KST에 실행하도록 설정
# 키움 REST API는 '허용 IP' 등록이 필요해 GitHub Actions(매번 다른 IP)에서는 NXT 보정을 못 하므로 이 서버가 담당.
# KRX 수집은 GitHub Actions도 계속 돌며(예비) 둘 다 '없는 것만 채우는' 방식이라 중복돼도 안전.
#
# 사용(서버에서):  curl -sL https://raw.githubusercontent.com/croxian/trading-journal/main/scripts/server/setup_oracle.sh | bash
# 다시 실행해도 안전(코드 갱신·크론 재등록만 함, .env는 덮지 않음)
set -euo pipefail

DIR="$HOME/trading-journal"
REPO="https://github.com/croxian/trading-journal.git"

echo "== 1/4 코드 받기"
command -v git >/dev/null || { echo "git이 필요합니다: sudo apt install -y git  (또는 sudo dnf install -y git)"; exit 1; }
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q --ff-only; else git clone -q "$REPO" "$DIR"; fi

echo "== 2/4 파이썬 환경(.venv)"
if ! python3 -m venv "$DIR/.venv" 2>/dev/null; then
  echo "python3-venv가 필요합니다: sudo apt install -y python3-venv  (오라클 리눅스: sudo dnf install -y python3)"; exit 1
fi
"$DIR/.venv/bin/pip" install -q --upgrade pip finance-datareader

echo "== 3/4 비밀 키 파일(.env)"
if [ ! -f "$DIR/.env" ]; then
  cat > "$DIR/.env" <<'EOF'
SUPABASE_SERVICE_KEY=
KIWOOM_APPKEY=
KIWOOM_SECRETKEY=
EOF
  echo "   .env를 만들었습니다 → 값을 채우세요:  nano $DIR/.env"
fi
chmod 600 "$DIR/.env"

echo "== 4/4 크론(매일 20:30 전체 + 1분마다 새 매매 즉시 수집)"
# 서버 시간대와 무관하게 KST 20:30에 맞춤(서버가 UTC면 11:30). 스크립트 내부 시간 판단도 TZ=Asia/Seoul로 실행
read -r H M < <(python3 -c "import datetime as d;k=d.timezone(d.timedelta(hours=9));t=d.datetime.now(k).replace(hour=20,minute=30).astimezone();print(t.hour,t.minute)")
LOCK=/tmp/trading-journal-market.lock
LINE="$M $H * * * cd $DIR && git pull -q --ff-only; TZ=Asia/Seoul flock -w 900 $LOCK $DIR/.venv/bin/python scripts/fetch_market.py upload >> $DIR/market_fetch.log 2>&1"
# 1분마다: 새로 쓴 매매일지의 시세를 바로 수집(+NXT). 할 일 없으면 조회 2번만 하고 조용히 끝남
QUICK="* * * * * cd $DIR && TZ=Asia/Seoul flock -n $LOCK $DIR/.venv/bin/python scripts/fetch_market.py quick >> $DIR/market_quick.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'scripts/fetch_market.py' || true; echo "$LINE"; echo "$QUICK" ) | crontab -
echo "   등록됨: $LINE"
echo "   등록됨: $QUICK"

echo
echo "✅ 설정 완료"
echo "   이 서버의 공인 IP(키움 포털 '허용 IP'에 등록): $(curl -s --max-time 5 ifconfig.me || echo '확인 실패')"
echo "   .env 값을 채운 뒤 과거 날짜 NXT 보정 한 번 실행:"
echo "     cd $DIR && TZ=Asia/Seoul .venv/bin/python scripts/fetch_market.py nxt"
echo "   실행 기록: tail -n 30 $DIR/market_fetch.log   (즉시 수집: tail -n 30 $DIR/market_quick.log)"
