#!/bin/bash
# リポジトリの apps から、検証に要るものだけを写す（共通部品はエミュレーター向けに差し替える）
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SP="${SH_WORK:?SH_WORK（作業フォルダ）を指定してね}"
mkdir -p "$SP"
rm -rf "$SP/site"; mkdir -p "$SP/site"
cp -R "$REPO/apps/shared" "$SP/site/shared"
cp -R "$REPO/apps/shirushi-hint" "$SP/site/shirushi-hint"
python3 - "$SP/site/shared/js/rtdb-utils.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
start = s.index('const FIREBASE_CONFIG = {')
end = s.index('};', start) + 2
# 設定がエミュレーター向けかどうかは、読み込んだ時点で確かめられるようにしておく
s = s[:start] + """const FIREBASE_CONFIG = {
    apiKey: 'demo-key',
    authDomain: 'demo-roomk-sh.firebaseapp.com',
    databaseURL: 'http://127.0.0.1:9582?ns=demo-roomk-sh',
    projectId: 'demo-roomk-sh',
    appId: 'demo-app',
  };
  window.__EMU__ = { projectId: FIREBASE_CONFIG.projectId, db: FIREBASE_CONFIG.databaseURL };""" + s[end:]
a = "firebaseNamespace.initializeApp(FIREBASE_CONFIG);"
assert s.count(a) == 1
s = s.replace(a, a + """
    firebaseNamespace.auth().useEmulator('http://127.0.0.1:9581', { disableWarnings: true });
    firebaseNamespace.database().useEmulator('127.0.0.1', 9582);""")
open(p, 'w', encoding='utf-8').write(s)
PY
echo "window.__STATS__ = []; window.RoomkStats = { count(item) { window.__STATS__.push(item); } };" > "$SP/site/shared/js/stats.js"
if grep -q "roomk-tools-default-rtdb" "$SP/site/shared/js/rtdb-utils.js"; then echo "PROD URL LEFT"; exit 1; fi
echo synced
