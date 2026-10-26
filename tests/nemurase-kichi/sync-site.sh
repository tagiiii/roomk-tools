#!/bin/bash
# リポジトリの apps から、検証に要るものだけを写す（接続先はエミュレーターに差し替える）
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SP="${NK_WORK:?NK_WORK（作業フォルダ）を指定してね}"
mkdir -p "$SP"
rm -rf "$SP/site"; mkdir -p "$SP/site"
cp -R "$REPO/apps/shared" "$SP/site/shared"
cp -R "$REPO/apps/nemurase-kichi" "$SP/site/nemurase-kichi"
# 接続先: ねむらせ基地の設定ファイルだけを、エミュレーター向けにまるごと差し替える
cat > "$SP/site/nemurase-kichi/firebase-config.js" <<'JS'
(function () {
  const CONFIG = { apiKey: 'demo-key', authDomain: 'demo-roomk-nk.firebaseapp.com', databaseURL: 'http://127.0.0.1:9882?ns=demo-roomk-nk', projectId: 'demo-roomk-nk', appId: 'demo-app' };
  window.__EMU__ = { projectId: CONFIG.projectId, db: CONFIG.databaseURL };
  function init(firebaseNamespace) {
    firebaseNamespace.initializeApp(CONFIG);
    firebaseNamespace.auth().useEmulator('http://127.0.0.1:9881', { disableWarnings: true });
    firebaseNamespace.database().useEmulator('127.0.0.1', 9882);
    const authReady = firebaseNamespace.auth().signInAnonymously();
    const db = firebaseNamespace.database();
    RoomkRTDB.initServerTime(db);
    return { authReady, db };
  }
  window.NemuraseFirebase = { init };
})();
JS
# テストから中の状態を読めるようにする（写しだけ。本体には入れない）
python3 - "$SP/site/nemurase-kichi/app.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
assert s.rstrip().endswith('init();')
s = s.rstrip()[:-len('init();')] + "window.__NK__ = { ME, state, PA, PG, BOTS, gameOf, KEYS };\ninit();\n"
open(p, 'w', encoding='utf-8').write(s)
PY
echo "window.__STATS__ = []; window.RoomkStats = { count(item) { window.__STATS__.push(item); } };" > "$SP/site/shared/js/stats.js"
if grep -rq "roomk-nemurase-default-rtdb\|firebasedatabase.app" "$SP/site/nemurase-kichi"; then echo "PROD URL LEFT"; exit 1; fi
echo synced
