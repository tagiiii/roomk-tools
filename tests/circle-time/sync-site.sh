#!/bin/bash
# リポジトリから検証に要るものだけを写す（共通部品はエミュレーター向けに差し替える）
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SP="${CT_WORK:?CT_WORK（作業フォルダ）を指定してね}"
mkdir -p "$SP"
rm -rf "$SP/site"; mkdir -p "$SP/site/apps"
cp -R "$REPO/apps/shared" "$SP/site/apps/shared"
if [ -d "$REPO/apps/assets" ]; then cp -R "$REPO/apps/assets" "$SP/site/apps/assets"; fi
cp -R "$REPO/apps/talk-card" "$SP/site/apps/talk-card"
cp -R "$REPO/apps/quiz" "$SP/site/apps/quiz"
cp -R "$REPO/apps/kotoba-mikke" "$SP/site/apps/kotoba-mikke"
cp "$REPO/apps/index.html" "$SP/site/apps/index.html"
cp -R "$REPO/apps/circle-time" "$SP/site/apps/circle-time"
# 「？」の中の「このツールの更新」が読む（2026-11-11 から。無いと、「？」を開く検査で 404 がコンソールに出る）
cp "$REPO/apps/updates.json" "$SP/site/apps/updates.json"
python3 - "$SP/site/apps/shared/js/rtdb-utils.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
start = s.index('const FIREBASE_CONFIG = {')
end = s.index('};', start) + 2
s = s[:start] + """const FIREBASE_CONFIG = {
    apiKey: 'demo-key',
    authDomain: 'demo-roomk-ct.firebaseapp.com',
    databaseURL: 'http://127.0.0.1:9932?ns=demo-roomk-ct',
    projectId: 'demo-roomk-ct',
    appId: 'demo-app',
  };
  window.__EMU__ = { projectId: FIREBASE_CONFIG.projectId, db: FIREBASE_CONFIG.databaseURL };""" + s[end:]
a = "firebaseNamespace.initializeApp(FIREBASE_CONFIG);"
assert s.count(a) == 1
s = s.replace(a, a + """
    firebaseNamespace.auth().useEmulator('http://127.0.0.1:9931', { disableWarnings: true });
    firebaseNamespace.database().useEmulator('127.0.0.1', 9932);""")
open(p, 'w', encoding='utf-8').write(s)
PY
echo "window.__STATS__ = []; window.RoomkStats = { count(item) { window.__STATS__.push(item); } };" > "$SP/site/apps/shared/js/stats.js"
if grep -q "roomk-tools-default-rtdb" "$SP/site/apps/shared/js/rtdb-utils.js"; then echo "PROD URL LEFT"; exit 1; fi
echo synced
