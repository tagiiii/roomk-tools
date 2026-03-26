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

# チェック対象の Realtime Database アプリ
APP_FILES=(
  "apps/iisen-show/index.html"
  "apps/word-wolf/index.html"
  "apps/name-change/index.html"
)

echo ""
echo -e "${BOLD}${BLUE}🔍 roomK lint チェック開始${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─────────────────────────────────────────────────────
# [SEC-1] XSS チェック
#   innerHTML に テンプレートリテラル変数 (${...}) を使って
#   いるのに esc() / escapeHtml() でラップしていない行を検出
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[SEC-1] XSS チェック${NC} — innerHTML + \${} に esc() なし"

for f in "${APP_FILES[@]}"; do
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
[ $ERRORS -eq 0 ] && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [SEC-2] esc() シングルクォート未対応チェック
#   esc() / escapeHtml() が ' → &#39; をエスケープしているか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[SEC-2] esc() シングルクォートエスケープチェック${NC}"

SEC2_OK=true
for f in "${APP_FILES[@]}"; do
  [ -f "$f" ] || continue

  # esc() チェック
  if grep -q "function esc(" "$f"; then
    if ! grep -A3 "function esc(" "$f" | grep -q "&#39;"; then
      line_num=$(grep -n "function esc(" "$f" | head -1 | cut -d: -f1)
      echo -e "  ${RED}[ERROR]${NC} $f:$line_num — esc() に .replace(/'/g,'&#39;') がありません"
      ERRORS=$((ERRORS + 1))
      SEC2_OK=false
    fi
  fi

  # escapeHtml() チェック
  if grep -q "function escapeHtml(" "$f"; then
    if ! grep -A5 "function escapeHtml(" "$f" | grep -q "&#39;"; then
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
#   Realtime DB アプリが design-system.css を読み込んでいるか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[CSS-1] design-system.css リンクチェック${NC}"

CSS1_OK=true
for f in "${APP_FILES[@]}"; do
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
for f in "${APP_FILES[@]}"; do
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
#   iisen-show が rooms/ ではなく iisen_rooms/ を使っているか
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[REF-2] Firebase パス命名規則チェック${NC}"

REF2_OK=true
if grep -qE '"rooms/' "apps/iisen-show/index.html" 2>/dev/null; then
  line_num=$(grep -nE '"rooms/' "apps/iisen-show/index.html" | head -1 | cut -d: -f1)
  echo -e "  ${YELLOW}[WARN]${NC} apps/iisen-show/index.html:$line_num — \"rooms/\" が使われています（iisen_rooms/ を使用）"
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
for f in "${APP_FILES[@]}"; do
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
