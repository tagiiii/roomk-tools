#!/bin/bash
# リポジトリの apps から、検証に要るものだけを写す（共通部品はエミュレーター向けに差し替える）
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SP="${HR_WORK:?HR_WORK（作業フォルダ）を指定してね}"
mkdir -p "$SP"
rm -rf "$SP/site"; mkdir -p "$SP/site/circle-time"
cp -R "$REPO/apps/shared" "$SP/site/shared"
cp -R "$REPO/apps/assets" "$SP/site/assets"
cp -R "$REPO/apps/hiroba-roulette" "$SP/site/hiroba-roulette"
cp -R "$REPO/apps/circle-time/daily" "$SP/site/circle-time/daily"
# ゲームの一覧（ツール一覧のカード）と、「？」の中の「このツールの更新」が読む
cp "$REPO/apps/index.html" "$SP/site/index.html"
cp "$REPO/apps/updates.json" "$SP/site/updates.json"
cp "$REPO/database.rules.json" "$SP/database.rules.json"
cp "$(dirname "$0")/firebase.json" "$SP/firebase.json"
python3 - "$SP/site/shared/js/rtdb-utils.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
start = s.index('const FIREBASE_CONFIG = {')
end = s.index('};', start) + 2
s = s[:start] + """const FIREBASE_CONFIG = {
    apiKey: 'demo-key',
    authDomain: 'demo-roomk-hr.firebaseapp.com',
    databaseURL: 'http://127.0.0.1:9652?ns=demo-roomk-hr',
    projectId: 'demo-roomk-hr',
    appId: 'demo-app',
  };
  window.__EMU__ = { projectId: FIREBASE_CONFIG.projectId, db: FIREBASE_CONFIG.databaseURL };""" + s[end:]
a = "firebaseNamespace.initializeApp(FIREBASE_CONFIG);"
assert s.count(a) == 1
s = s.replace(a, a + """
    firebaseNamespace.auth().useEmulator('http://127.0.0.1:9651', { disableWarnings: true });
    firebaseNamespace.database().useEmulator('127.0.0.1', 9652);""")
open(p, 'w', encoding='utf-8').write(s)
PY
echo "window.__STATS__ = []; window.RoomkStats = { count(item) { window.__STATS__.push(item); } };" > "$SP/site/shared/js/stats.js"
if grep -q "roomk-tools-default-rtdb" "$SP/site/shared/js/rtdb-utils.js"; then echo "PROD URL LEFT"; exit 1; fi
echo synced
