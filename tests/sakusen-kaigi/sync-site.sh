#!/bin/bash
# リポジトリから検証に要るものだけを写す（共通部品はエミュレーター向けに差し替える。本番の Firebase には接続しない）
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SP="${SK_WORK:?SK_WORK（作業フォルダ）を指定してね}"
mkdir -p "$SP"
rm -rf "$SP/site"; mkdir -p "$SP/site/apps/circle-time"
cp -R "$REPO/apps/shared" "$SP/site/apps/shared"
cp -R "$REPO/apps/assets" "$SP/site/apps/assets"
cp -R "$REPO/apps/talk-card" "$SP/site/apps/talk-card"
# ツールを開いてルームを作ると参加用のリンクが届く、を本物のツールで確かめる（クイズパック・リバーシ）
cp -R "$REPO/apps/quiz" "$SP/site/apps/quiz"
cp -R "$REPO/apps/reversi" "$SP/site/apps/reversi"
cp "$REPO/apps/index.html" "$SP/site/apps/index.html"
cp "$REPO/apps/updates.json" "$SP/site/apps/updates.json"
cp -R "$REPO/apps/sakusen-kaigi" "$SP/site/apps/sakusen-kaigi"
# お知らせ（単発実施プログラム）は、検証用の決まった中身に差し替える（e2e の中で日付を合わせて書く）
mkdir -p "$SP/site/apps/circle-time/daily"
python3 - "$SP/site/apps/shared/js/rtdb-utils.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
start = s.index('const FIREBASE_CONFIG = {')
end = s.index('};', start) + 2
s = s[:start] + """const FIREBASE_CONFIG = {
    apiKey: 'demo-key',
    authDomain: 'demo-roomk-sk.firebaseapp.com',
    databaseURL: 'http://127.0.0.1:9942?ns=demo-roomk-sk',
    projectId: 'demo-roomk-sk',
    appId: 'demo-app',
  };
  window.__EMU__ = { projectId: FIREBASE_CONFIG.projectId, db: FIREBASE_CONFIG.databaseURL };""" + s[end:]
a = "firebaseNamespace.initializeApp(FIREBASE_CONFIG);"
assert s.count(a) == 1
s = s.replace(a, a + """
    firebaseNamespace.auth().useEmulator('http://127.0.0.1:9941', { disableWarnings: true });
    firebaseNamespace.database().useEmulator('127.0.0.1', 9942);""")
open(p, 'w', encoding='utf-8').write(s)
PY
echo "window.__STATS__ = []; window.RoomkStats = { count(item) { window.__STATS__.push(item); } };" > "$SP/site/apps/shared/js/stats.js"
if grep -rq "roomk-tools-default-rtdb" "$SP/site/apps/shared/js/rtdb-utils.js"; then echo "PROD URL LEFT"; exit 1; fi
echo synced
