#!/bin/bash
# ============================================================
#  roomK lint チェックスクリプト
#  用途: セキュリティ・不具合・リファクタリング違反を検出
#  実行: bash scripts/lint.sh
# ============================================================

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

# チェック対象ファイル
ALL_HTML_FILES=(apps/*/index.html)
ALL_JS_FILES=(apps/*/app.js)

# Realtime Database アプリ
RTDB_HTML_FILES=(
  "apps/do-mannaka/index.html"
  "apps/esadori/index.html"
  "apps/ikutsu-ieru/index.html"
  "apps/jinro/index.html"
  "apps/kaburazu-hint/index.html"
  "apps/kakure-number/index.html"
  "apps/koedake-theater/index.html"
  "apps/magire-eshi/index.html"
  "apps/name-change/index.html"
  "apps/oshitsuke-zukan/index.html"
  "apps/pita-hame/index.html"
  "apps/pittari-meter/index.html"
  "apps/tatoe-gp/index.html"
  "apps/tatoe-narabe/index.html"
  "apps/uso-jisho/index.html"
  "apps/word-wolf/index.html"
)

XSS_FILES=("${ALL_HTML_FILES[@]}" "${ALL_JS_FILES[@]}")
CSS_FILES=("${ALL_HTML_FILES[@]}")

echo ""
echo -e "${BOLD}${BLUE}🔍 roomK lint チェック開始${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─────────────────────────────────────────────────────
# [SEC-1] XSS チェック
#   innerHTML に テンプレートリテラル変数 (${...}) を使って
#   いるのに esc() / escapeHtml() でラップしていない箇所を検出。
#   (1) 単一行  : 行 grep（従来どおり）
#   (2) 複数行  : `.innerHTML =/+= \`...\`` テンプレートブロックを
#                 python3 で構文的に解析し、各 ${...} 補間を検査する。
#                 文字列リテラルを変数/プロパティに + 連結して未エスケープで
#                 差し込む（例: ${'<b>' + name}）補間を ERROR とする。
#                 esc()/escapeHtml()/RoomkRTDB.esc() 済み・数値・定数参照・
#                 関数呼び出し・リテラルのみの補間は安全として通す。
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[SEC-1] XSS チェック${NC} — innerHTML + \${} に esc() なし"

# (1) 単一行チェック（従来の挙動を維持）
for f in "${XSS_FILES[@]}"; do
  [ -f "$f" ] || continue
  while IFS=: read -r line_num content; do
    echo -e "  ${RED}[ERROR]${NC} $f:$line_num"
    echo -e "         ${content}"
    ERRORS=$((ERRORS + 1))
  done < <(grep -n '\.innerHTML' "$f" \
    | grep '\${' \
    | grep -v 'esc(' \
    | grep -v 'escapeHtml(')
done

# (2) 複数行テンプレートブロックチェック
SEC1_ML_OUT=$(python3 - <<'PYEOF'
import glob, re, sys

BT = chr(96)  # backtick char, built via chr() to keep it out of this heredoc

FILES = sorted(glob.glob('apps/*/index.html') + glob.glob('apps/*/app.js'))

INNER = re.compile(r'\.innerHTML\s*\+?=\s*' + BT)
ESC_RE = re.compile(r'\besc[A-Za-z]*\(|escapeHtml\(')

def parse_template(s, i):
    """s[i] is the opening backtick. Return (close_index, [(start, expr), ...])."""
    interps = []
    j, n = i + 1, len(s)
    while j < n:
        c = s[j]
        if c == '\\':
            j += 2; continue
        if c == BT:
            return j, interps
        if c == '$' and j + 1 < n and s[j+1] == '{':
            start = j + 2
            expr, j = parse_interp(s, start)
            interps.append((start, expr)); continue
        j += 1
    return n, interps

def parse_interp(s, i):
    """s[i] = first char after '${'. Return (expr_text, index_after_'}')."""
    depth, start, j, n = 1, i, i, len(s)
    while j < n:
        c = s[j]
        if c == '\\':
            j += 2; continue
        if c in ('"', "'"):
            q = c; j += 1
            while j < n:
                if s[j] == '\\': j += 2; continue
                if s[j] == q: j += 1; break
                j += 1
            continue
        if c == BT:
            end, _ = parse_template(s, j); j = end + 1; continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return s[start:j], j + 1
        j += 1
    return s[start:j], j

def strip_literals(e):
    out = []; j, n = 0, len(e)
    while j < n:
        c = e[j]
        if c in ('"', "'", BT):
            q = c; j += 1
            while j < n:
                if e[j] == '\\': j += 2; continue
                if e[j] == q: j += 1; break
                j += 1
            out.append('""'); continue
        out.append(c); j += 1
    return ''.join(out)

def is_unsafe(expr):
    e = expr.strip()
    if ESC_RE.search(e):
        return False
    st = strip_literals(e)
    # 文字列リテラルを 変数/プロパティ/添字 に + 連結（未エスケープの HTML 組み立て）
    return bool(
        re.search(r'""\s*\+\s*[A-Za-z_$]', st)
        or re.search(r'[A-Za-z_$][\w$.]*(?:\[[^\]]*\])?\s*\+\s*""', st)
    )

for f in FILES:
    try:
        with open(f, encoding='utf-8') as fh:
            s = fh.read()
    except OSError:
        continue
    for m in INNER.finditer(s):
        bt = m.end() - 1
        end, interps = parse_template(s, bt)
        block = s[bt:end + 1]
        if '\n' not in block:
            continue  # 単一行テンプレートは (1) の行 grep が担当
        for pos, expr in interps:
            if is_unsafe(expr):
                ln = s.count('\n', 0, pos) + 1
                snippet = re.sub(r'\s+', ' ', expr.strip())[:100]
                print(f'{f}:{ln}\t${{{snippet}}}')
PYEOF
)

if [ -n "$SEC1_ML_OUT" ]; then
  while IFS=$'\t' read -r loc snippet; do
    [ -n "$loc" ] || continue
    echo -e "  ${RED}[ERROR]${NC} $loc"
    echo -e "         ${snippet}"
    ERRORS=$((ERRORS + 1))
  done <<< "$SEC1_ML_OUT"
fi

[ $ERRORS -eq 0 ] && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [SEC-2] esc() シングルクォート未対応チェック
#   esc() / escapeHtml() が ' → &#39; をエスケープしているか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[SEC-2] esc() シングルクォートエスケープチェック${NC}"

SEC2_OK=true
for f in "${XSS_FILES[@]}"; do
  [ -f "$f" ] || continue

  # esc() チェック
  if grep -q "function esc(" "$f"; then
    if ! grep -A8 "function esc(" "$f" | grep -q "&#39;"; then
      line_num=$(grep -n "function esc(" "$f" | head -1 | cut -d: -f1)
      echo -e "  ${RED}[ERROR]${NC} $f:$line_num — esc() に .replace(/'/g,'&#39;') がありません"
      ERRORS=$((ERRORS + 1))
      SEC2_OK=false
    fi
  fi

  # escapeHtml() チェック
  if grep -q "function escapeHtml(" "$f"; then
    if ! grep -A8 "function escapeHtml(" "$f" | grep -q "&#39;"; then
      line_num=$(grep -n "function escapeHtml(" "$f" | head -1 | cut -d: -f1)
      echo -e "  ${RED}[ERROR]${NC} $f:$line_num — escapeHtml() に .replace(/'/g,'&#39;') がありません"
      ERRORS=$((ERRORS + 1))
      SEC2_OK=false
    fi
  fi
done
$SEC2_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [CSS-1] design-system.css リンクチェック
#   各アプリが design-system.css を読み込んでいるか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[CSS-1] design-system.css リンクチェック${NC}"

CSS1_OK=true
for f in "${CSS_FILES[@]}"; do
  [ -f "$f" ] || continue
  if ! grep -q "design-system.css" "$f"; then
    echo -e "  ${RED}[ERROR]${NC} $f — design-system.css がリンクされていません"
    ERRORS=$((ERRORS + 1))
    CSS1_OK=false
  fi
done
$CSS1_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [CSS-2] :root 重複定義チェック
#   design-system.css を読み込んでいるのに :root を再定義していないか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[CSS-2] :root 重複定義チェック${NC}"

CSS2_OK=true
for f in "${CSS_FILES[@]}"; do
  [ -f "$f" ] || continue
  if grep -q "design-system.css" "$f" && grep -qE "^\s*:root\s*\{" "$f"; then
    line_num=$(grep -nE "^\s*:root\s*\{" "$f" | head -1 | cut -d: -f1)
    echo -e "  ${RED}[ERROR]${NC} $f:$line_num — design-system.css 読み込み済みなのに :root を再定義しています"
    ERRORS=$((ERRORS + 1))
    CSS2_OK=false
  fi
done
$CSS2_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [VIEWPORT-1] Realtime Database アプリ viewport チェック
#   ゲーム中の誤ズーム防止のため maximum-scale=1 を指定しているか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[VIEWPORT-1] Realtime Database viewport チェック${NC}"

VIEWPORT1_OK=true
for f in "${RTDB_HTML_FILES[@]}"; do
  [ -f "$f" ] || continue
  if ! grep -qE '<meta[^>]+name=["'\'']viewport["'\''][^>]+maximum-scale=1' "$f"; then
    line_num=$(grep -nE '<meta[^>]+name=["'\'']viewport["'\'']' "$f" | head -1 | cut -d: -f1)
    [ -n "$line_num" ] || line_num=1
    echo -e "  ${RED}[ERROR]${NC} $f:$line_num — Realtime Database アプリは viewport に maximum-scale=1 を指定してください"
    ERRORS=$((ERRORS + 1))
    VIEWPORT1_OK=false
  fi
done
$VIEWPORT1_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [REF-1] .app-header 誤使用チェック (name-change)
#   .nc-header にリネーム済みのため app-header が残っていないか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[REF-1] .app-header 誤使用チェック (name-change)${NC}"

if grep -q 'class="app-header"' "apps/name-change/index.html" 2>/dev/null; then
  line_num=$(grep -n 'class="app-header"' "apps/name-change/index.html" | head -1 | cut -d: -f1)
  echo -e "  ${RED}[ERROR]${NC} apps/name-change/index.html:$line_num — class=\"app-header\" が残っています（.nc-header に変更）"
  ERRORS=$((ERRORS + 1))
else
  echo -e "  ${GREEN}OK${NC}"
fi

# ─────────────────────────────────────────────────────
# [REF-2] Firebase パス命名規則チェック
#   do-mannaka が rooms/ ではなく domannaka_rooms/ を使っているか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[REF-2] Firebase パス命名規則チェック${NC}"

REF2_OK=true
if grep -qE '"rooms/' "apps/do-mannaka/index.html" 2>/dev/null; then
  line_num=$(grep -nE '"rooms/' "apps/do-mannaka/index.html" | head -1 | cut -d: -f1)
  echo -e "  ${YELLOW}[WARN]${NC} apps/do-mannaka/index.html:$line_num — \"rooms/\" が使われています（domannaka_rooms/ を使用）"
  WARNINGS=$((WARNINGS + 1))
  REF2_OK=false
fi
$REF2_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [REF-3] 重複ユーティリティ関数チェック
#   utils.js にある関数がアプリ内で再定義されていないか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[REF-3] 重複ユーティリティ関数チェック${NC}"

REF3_OK=true
UTILS_FUNCS=("function shuffle(" "function escapeHtml(")
for f in "${XSS_FILES[@]}"; do
  [ -f "$f" ] || continue
  for func in "${UTILS_FUNCS[@]}"; do
    if grep -q "$func" "$f"; then
      line_num=$(grep -n "$func" "$f" | head -1 | cut -d: -f1)
      func_name=$(echo "$func" | sed 's/function //' | sed 's/($//')
      echo -e "  ${YELLOW}[WARN]${NC} $f:$line_num — ${func_name}() は utils.js と重複しています（type=\"module\" 化で import 可能）"
      WARNINGS=$((WARNINGS + 1))
      REF3_OK=false
    fi
  done
done
$REF3_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [REF-4] ホスト切断 TTL チェック
#   RTDB アプリの ORPHAN_TTL(_MS) は AGENTS.md 推奨の 2分（2 * 60 * 1000）に揃える
#   ※ ゲーム中フェーズ用の延長 TTL（例: ORPHAN_TTL_INGAME_MS）は対象外
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[REF-4] ホスト切断 TTL チェック${NC}"

REF4_OK=true
for f in "${RTDB_HTML_FILES[@]}"; do
  [ -f "$f" ] || continue
  while IFS=: read -r line_num content; do
    # ORPHAN_TTL_INGAME_MS など派生定数は対象外
    echo "$content" | grep -qE 'ORPHAN_TTL(_MS)?\s*=' || continue
    if ! echo "$content" | grep -qE '=\s*2\s*\*\s*60\s*\*\s*1000'; then
      echo -e "  ${YELLOW}[WARN]${NC} $f:$line_num — ORPHAN_TTL は 2 * 60 * 1000（2分）推奨です"
      echo -e "         ${content}"
      WARNINGS=$((WARNINGS + 1))
      REF4_OK=false
    fi
  done < <(grep -nE 'ORPHAN_TTL(_MS)?\s*=' "$f")
done
$REF4_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [PORTAL-1] updates.json 整合チェック
#   JSON として妥当か・必須フィールド・date 形式・
#   type の値・app がポータル上の実在アプリかを検証
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[PORTAL-1] updates.json 整合チェック${NC}"

PORTAL1_OUT=$(python3 - <<'PYEOF'
import json, os, re

try:
    with open('apps/updates.json', encoding='utf-8') as f:
        entries = json.load(f)
except FileNotFoundError:
    print('apps/updates.json がありません')
    raise SystemExit
except Exception as e:
    print(f'apps/updates.json を JSON として読み込めません: {e}')
    raise SystemExit

if not isinstance(entries, list):
    print('apps/updates.json のトップレベルは配列にしてください')
    raise SystemExit

for i, e in enumerate(entries, 1):
    where = f'エントリ {i}'
    if not isinstance(e, dict):
        print(f'{where}: オブジェクトではありません')
        continue
    for key in ('date', 'app', 'type', 'text'):
        if key not in e:
            print(f'{where}: "{key}" がありません')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(e.get('date', ''))):
        print(f'{where}: date は YYYY-MM-DD 形式にしてください → {e.get("date")!r}')
    if e.get('type') not in ('new', 'update'):
        print(f'{where}: type は "new" か "update" にしてください → {e.get("type")!r}')
    app = e.get('app')
    if app is not None and not os.path.isdir(os.path.join('apps', str(app))):
        print(f'{where}: apps/{app}/ が存在しません')
PYEOF
)

if [ -n "$PORTAL1_OUT" ]; then
  while IFS= read -r line; do
    echo -e "  ${RED}[ERROR]${NC} $line"
    ERRORS=$((ERRORS + 1))
  done <<< "$PORTAL1_OUT"
else
  echo -e "  ${GREEN}OK${NC}"
fi

# ─────────────────────────────────────────────────────
# [PORTAL-2] data-scenes チェック
#   ポータルの表示中カード全てに data-scenes があり、
#   シーンキーが有効値のみかを検証（AGENTS.md「利用シーンタグ」）
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[PORTAL-2] ポータルカード data-scenes チェック${NC}"

PORTAL2_OUT=$(python3 - <<'PYEOF'
import re

with open('apps/index.html', encoding='utf-8') as f:
    html = f.read()

# コメントアウトされた非表示カードは対象外
html = re.sub(r'<!--.*?-->', '', html, flags=re.S)

VALID = {'kotoba', 'bodoge', 'hiroba', 'circle', 'sakusen'}

for m in re.finditer(r'<a class="app-card"([^>]*)>', html):
    attrs = m.group(1)
    href = re.search(r'href="([^"]+)"', attrs)
    name = href.group(1) if href else '(href 不明)'
    ds = re.search(r'data-scenes="([^"]*)"', attrs)
    if not ds:
        print(f'{name}: data-scenes がありません（キー: kotoba/bodoge/hiroba/circle/sakusen）')
        continue
    scenes = ds.group(1).split()
    if not scenes:
        print(f'{name}: data-scenes が空です')
        continue
    bad = [s for s in scenes if s not in VALID]
    if bad:
        print(f'{name}: 不明なシーンキー {", ".join(bad)}（有効: kotoba/bodoge/hiroba/circle/sakusen）')
PYEOF
)

if [ -n "$PORTAL2_OUT" ]; then
  while IFS= read -r line; do
    echo -e "  ${RED}[ERROR]${NC} $line"
    ERRORS=$((ERRORS + 1))
  done <<< "$PORTAL2_OUT"
else
  echo -e "  ${GREEN}OK${NC}"
fi

# ─────────────────────────────────────────────────────
# [CONTENT-1] 絵文字チェック
#   絵文字は使わず Material Symbols を使う（AGENTS.md）。
#   ピクトグラム絵文字はエラー、⭕❌等の記号絵文字は警告
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[CONTENT-1] 絵文字チェック${NC} — 絵文字ではなく Material Symbols を使う"

CONTENT1_OUT=$(python3 - <<'PYEOF'
import glob, html, re

ERROR_PAT = re.compile('[\U0001F000-\U0001FAFF️]')
WARN_PAT = re.compile('[✅❌❤⭐⭕]')

files = sorted(
    glob.glob('apps/**/*.html', recursive=True)
    + glob.glob('apps/**/*.js', recursive=True)
    + glob.glob('apps/**/*.json', recursive=True)
)
for f in files:
    with open(f, encoding='utf-8') as fh:
        for i, line in enumerate(fh, 1):
            decoded = html.unescape(line)
            if ERROR_PAT.search(decoded):
                print(f'ERROR\t{f}:{i}\t絵文字が含まれています')
            elif WARN_PAT.search(decoded):
                print(f'WARN\t{f}:{i}\t記号絵文字（⭕❌など）は Material Symbols への置換を推奨')
PYEOF
)

CONTENT1_OK=true
if [ -n "$CONTENT1_OUT" ]; then
  while IFS=$'\t' read -r level loc msg; do
    [ -n "$level" ] || continue
    if [ "$level" = "ERROR" ]; then
      echo -e "  ${RED}[ERROR]${NC} $loc — $msg"
      ERRORS=$((ERRORS + 1))
    else
      echo -e "  ${YELLOW}[WARN]${NC} $loc — $msg"
      WARNINGS=$((WARNINGS + 1))
    fi
    CONTENT1_OK=false
  done <<< "$CONTENT1_OUT"
fi
$CONTENT1_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [HOWTO-1] あそびかたモーダル (howto.js) チェック
#   全アプリ必須（AGENTS.md）。checkin / vote は本体スタブのため除外
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[HOWTO-1] あそびかたモーダル (howto.js) チェック${NC}"

HOWTO1_OK=true
# apps/ito, apps/iisen-show, apps/hint-de-pinto, apps/codenames, apps/sukina-map は
# 旧URLからの自動移動スタブ（location.replace のみ・howto.js 不要）。
# apps/guide/index.html はスタッフ向け説明ページ自体のため howto.js 対象外。
# apps/stats-view/index.html は開発者専用の利用状況ダッシュボード
# （ポータル未登録・URL 直打ち前提）のため howto.js 対象外。
HOWTO_EXEMPT=" apps/checkin/index.html apps/vote/index.html apps/ito/index.html apps/iisen-show/index.html apps/hint-de-pinto/index.html apps/codenames/index.html apps/sukina-map/index.html apps/guide/index.html apps/stats-view/index.html "
for f in "${ALL_HTML_FILES[@]}"; do
  [ -f "$f" ] || continue
  case "$HOWTO_EXEMPT" in *" $f "*) continue ;; esac
  if ! grep -q "howto.js" "$f"; then
    echo -e "  ${YELLOW}[WARN]${NC} $f — howto.js（あそびかたモーダル）が組み込まれていません"
    WARNINGS=$((WARNINGS + 1))
    HOWTO1_OK=false
  fi
done
$HOWTO1_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [DEP-1] CDN バージョン固定チェック
#   @latest は上流改竄がそのまま利用者に届くため禁止。
#   バージョンを固定し、可能なら integrity (SRI) も付ける
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[DEP-1] CDN バージョン固定チェック${NC} — @latest 禁止"

DEP1_OK=true
for f in apps/*/*.html; do
  [ -f "$f" ] || continue
  while IFS=: read -r line_num content; do
    echo -e "  ${RED}[ERROR]${NC} $f:$line_num — CDN はバージョンを固定してください（@latest 禁止）"
    ERRORS=$((ERRORS + 1))
    DEP1_OK=false
  done < <(grep -n '@latest' "$f")
done
$DEP1_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [VIEWPORT-2] 非 RTDB アプリの maximum-scale チェック
#   ズーム抑止は誤ズーム防止が必要な RTDB アプリのみ。
#   それ以外への付与はピンチズームを封じるだけで a11y 上不利
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[VIEWPORT-2] 非 RTDB アプリの maximum-scale チェック${NC}"

VIEWPORT2_OK=true
RTDB_LIST=" ${RTDB_HTML_FILES[*]} "
for f in "${ALL_HTML_FILES[@]}"; do
  [ -f "$f" ] || continue
  case "$RTDB_LIST" in *" $f "*) continue ;; esac
  if grep -qE '<meta[^>]+name=["'\'']viewport["'\''][^>]+maximum-scale=1' "$f"; then
    line_num=$(grep -nE '<meta[^>]+name=["'\'']viewport["'\'']' "$f" | head -1 | cut -d: -f1)
    echo -e "  ${YELLOW}[WARN]${NC} $f:$line_num — 非 RTDB アプリに maximum-scale=1 は不要です（ズーム抑止は RTDB アプリのみ）"
    WARNINGS=$((WARNINGS + 1))
    VIEWPORT2_OK=false
  fi
done
$VIEWPORT2_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [REF-5] タイマー解放バランスチェック
#   RTDB アプリで setInterval の数が clearInterval より多い場合、
#   leaveGame()/goToTop() での解放漏れの可能性（AGENTS.md）
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[REF-5] タイマー解放バランスチェック${NC}"

REF5_OK=true
for f in "${RTDB_HTML_FILES[@]}"; do
  [ -f "$f" ] || continue
  si=$(grep -c 'setInterval(' "$f")
  ci=$(grep -c 'clearInterval(' "$f")
  if [ "$si" -gt "$ci" ]; then
    echo -e "  ${YELLOW}[WARN]${NC} $f — setInterval ${si} 件に対し clearInterval ${ci} 件（解放漏れの可能性）"
    WARNINGS=$((WARNINGS + 1))
    REF5_OK=false
  fi
done
$REF5_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# 結果サマリ
# ─────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✅ 問題なし — すべてのチェックをパスしました${NC}"
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}${BOLD}⚠️  警告 ${WARNINGS} 件 （エラーなし）${NC}"
  echo -e "   警告は推奨事項です。コミットは可能です。"
else
  echo -e "${RED}${BOLD}❌ エラー ${ERRORS} 件、警告 ${WARNINGS} 件${NC}"
  echo -e "   エラーを修正してからコミットしてください。"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exit $ERRORS
