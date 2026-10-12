#!/bin/bash
# リポジトリの apps から、検証に要るものだけを写す（共通部品はエミュレーター向けに差し替える）
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SP="${SC_WORK:?SC_WORK（作業フォルダ）を指定してね}"
mkdir -p "$SP"
rm -rf "$SP/site"; mkdir -p "$SP/site"
cp -R "$REPO/apps/shared" "$SP/site/shared"
cp -R "$REPO/apps/sakusen-chat" "$SP/site/sakusen-chat"
python3 - "$SP/site/shared/js/rtdb-utils.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
start = s.index('const FIREBASE_CONFIG = {')
end = s.index('};', start) + 2
s = s[:start] + """const FIREBASE_CONFIG = {
    apiKey: 'demo-key',
    authDomain: 'demo-roomk-sc.firebaseapp.com',
    databaseURL: 'http://127.0.0.1:9482?ns=demo-roomk-sc',
    projectId: 'demo-roomk-sc',
    appId: 'demo-app',
  };""" + s[end:]
a = "firebaseNamespace.initializeApp(FIREBASE_CONFIG);"
assert s.count(a) == 1
s = s.replace(a, a + """
    firebaseNamespace.auth().useEmulator('http://127.0.0.1:9481', { disableWarnings: true });
    firebaseNamespace.database().useEmulator('127.0.0.1', 9482);
    window.__EMU__ = { projectId: FIREBASE_CONFIG.projectId, db: FIREBASE_CONFIG.databaseURL };""")
open(p, 'w', encoding='utf-8').write(s)
PY
echo "window.__STATS__ = []; window.RoomkStats = { count(item) { window.__STATS__.push(item); } };" > "$SP/site/shared/js/stats.js"
if grep -q "roomk-tools-default-rtdb" "$SP/site/shared/js/rtdb-utils.js"; then echo "PROD URL LEFT"; exit 1; fi
echo synced
