#!/bin/bash
# リポジトリの apps から、検証に要るものだけを写す（共通部品はエミュレーター向けに差し替える）。
# RULES=proposed で docs/feedback-loop の feedback ルールを足した rules を、RULES=current で今の rules をそのまま置く。
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SP="${FB_WORK:?FB_WORK（作業フォルダ）を指定してね}"
mkdir -p "$SP"
rm -rf "$SP/site"; mkdir -p "$SP/site/guide"
cp -R "$REPO/apps/shared" "$SP/site/shared"
cp -R "$REPO/apps/guide/feedback" "$SP/site/guide/feedback"
python3 - "$SP/site/shared/js/rtdb-utils.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
start = s.index('const FIREBASE_CONFIG = {')
end = s.index('};', start) + 2
s = s[:start] + """const FIREBASE_CONFIG = {
    apiKey: 'demo-key',
    authDomain: 'demo-roomk-fb.firebaseapp.com',
    databaseURL: 'http://127.0.0.1:9602?ns=demo-roomk-fb',
    projectId: 'demo-roomk-fb',
    appId: 'demo-app',
  };
  window.__EMU__ = { projectId: FIREBASE_CONFIG.projectId, db: FIREBASE_CONFIG.databaseURL };""" + s[end:]
a = "firebaseNamespace.initializeApp(FIREBASE_CONFIG);"
assert s.count(a) == 1
s = s.replace(a, a + """
    firebaseNamespace.auth().useEmulator('http://127.0.0.1:9601', { disableWarnings: true });
    firebaseNamespace.database().useEmulator('127.0.0.1', 9602);""")
open(p, 'w', encoding='utf-8').write(s)
PY
echo "window.__STATS__ = []; window.RoomkStats = { count(item) { window.__STATS__.push(item); } };" > "$SP/site/shared/js/stats.js"
if grep -q "roomk-tools-default-rtdb" "$SP/site/shared/js/rtdb-utils.js"; then echo "PROD URL LEFT"; exit 1; fi
cp "$REPO/tests/feedback/firebase.json" "$SP/"
python3 - "$REPO/database.rules.json" "$REPO/docs/feedback-loop/database.rules.feedback.md" "$SP/database.rules.json" "${RULES:-proposed}" <<'PY'
import sys, json, re
cur = json.load(open(sys.argv[1], encoding='utf-8'))
if sys.argv[4] == 'proposed':
    md = open(sys.argv[2], encoding='utf-8').read()
    block = re.search(r'```json\n(.*?)\n```', md, re.S).group(1).rstrip().rstrip(',')
    add = json.loads('{' + block + '}')
    cur['rules'] = {**add, **cur['rules']}
json.dump(cur, open(sys.argv[3], 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('rules:', sys.argv[4], list(cur['rules'].keys()))
PY
echo synced
