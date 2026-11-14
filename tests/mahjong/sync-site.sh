#!/bin/bash
# リポジトリの apps から、検証に要るものだけを写す（共通部品はエミュレーター向けに差し替える）
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SP="${MJ_WORK:?MJ_WORK（作業フォルダ）を指定してね}"
mkdir -p "$SP"
rm -rf "$SP/site"; mkdir -p "$SP/site"
cp -R "$REPO/apps/shared" "$SP/site/shared"
if [ -d "$REPO/apps/assets" ]; then cp -R "$REPO/apps/assets" "$SP/site/assets"; fi
cp -R "$REPO/apps/mahjong" "$SP/site/mahjong"
# 「？」の中の「このツールの更新」が読む（無いと、「？」を開く検査で 404 がコンソールに出る）
cp "$REPO/apps/updates.json" "$SP/site/updates.json"
python3 - "$SP/site/shared/js/rtdb-utils.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
start = s.index('const FIREBASE_CONFIG = {')
end = s.index('};', start) + 2
s = s[:start] + """const FIREBASE_CONFIG = {
    apiKey: 'demo-key',
    authDomain: 'demo-roomk-mj.firebaseapp.com',
    databaseURL: 'http://127.0.0.1:9642?ns=demo-roomk-mj',
    projectId: 'demo-roomk-mj',
    appId: 'demo-app',
  };
  window.__EMU__ = { projectId: FIREBASE_CONFIG.projectId, db: FIREBASE_CONFIG.databaseURL };""" + s[end:]
a = "firebaseNamespace.initializeApp(FIREBASE_CONFIG);"
assert s.count(a) == 1
s = s.replace(a, a + """
    firebaseNamespace.auth().useEmulator('http://127.0.0.1:9641', { disableWarnings: true });
    firebaseNamespace.database().useEmulator('127.0.0.1', 9642);""")
open(p, 'w', encoding='utf-8').write(s)
PY
echo "window.__STATS__ = []; window.RoomkStats = { count(item) { window.__STATS__.push(item); } };" > "$SP/site/shared/js/stats.js"
if grep -q "roomk-tools-default-rtdb" "$SP/site/shared/js/rtdb-utils.js"; then echo "PROD URL LEFT"; exit 1; fi
echo synced
