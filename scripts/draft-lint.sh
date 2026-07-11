#!/bin/bash
# ============================================================
#  roomK draft-lint チェックスクリプト（drafts/ プロトタイプ制度用）
#  用途: drafts/*/ のプロトタイプが制度の技術条件を満たすか検査
#        ① innerHTML + ${} の esc なし（lint.sh SEC-1 と同型）
#        ② 外部通信・外部リソースの禁止
#           （fonts.googleapis.com / fonts.gstatic.com のみ許可）
#        ③ 絵文字検出（Material Symbols を使う）
#  実行: bash scripts/draft-lint.sh
#  備考: 既存 scripts/lint.sh とは独立。apps/ には関与しない
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

echo ""
echo -e "${BOLD}${BLUE}🔍 roomK draft-lint チェック開始${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -d drafts ] || ! find drafts -mindepth 1 -maxdepth 1 -type d | grep -q .; then
  echo ""
  echo "drafts/ にプロトタイプがありません — チェック対象 0 件"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

# 検査対象: drafts 配下の html / js / css（監査表などの .md は対象外）
DRAFT_FILES=()
while IFS= read -r f; do
  DRAFT_FILES+=("$f")
done < <(find drafts -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) | sort)

# ─────────────────────────────────────────────────────
# [D-SEC-1] XSS チェック（lint.sh SEC-1 と同型）
#   innerHTML にテンプレートリテラル変数 (${...}) を使って
#   いるのに esc() / escapeHtml() でラップしていない行を検出
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[D-SEC-1] XSS チェック${NC} — innerHTML + \${} に esc() なし"

DSEC1_OK=true
for f in "${DRAFT_FILES[@]}"; do
  while IFS=: read -r line_num content; do
    echo -e "  ${RED}[ERROR]${NC} $f:$line_num"
    echo -e "         ${content}"
    ERRORS=$((ERRORS + 1))
    DSEC1_OK=false
  done < <(grep -n '\.innerHTML' "$f" \
    | grep '\${' \
    | grep -v 'esc(' \
    | grep -v 'escapeHtml(')
done
$DSEC1_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [D-NET-1] 外部通信・外部リソース禁止チェック
#   drafts/ は Firebase 未接続・オフラインモックのみ。
#   fetch / XMLHttpRequest / WebSocket / sendBeacon / firebase と
#   外部 URL（http(s):// / //）を検出。
#   許可: fonts.googleapis.com / fonts.gstatic.com のみ
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[D-NET-1] 外部通信・外部リソース禁止チェック${NC} — Google Fonts のみ許可"

DNET1_OK=true
NET_PATTERNS=(
  'fetch\s*\('
  'XMLHttpRequest'
  'new\s+WebSocket|wss?://'
  'sendBeacon'
  '[Ff]irebase'
  'EventSource'
)
NET_LABELS=(
  'fetch は禁止です（オフラインモックのみ）'
  'XMLHttpRequest は禁止です（オフラインモックのみ）'
  'WebSocket は禁止です（オフラインモックのみ）'
  'sendBeacon は禁止です（オフラインモックのみ）'
  'Firebase は接続禁止です（drafts はオフラインモックのみ）'
  'EventSource は禁止です（オフラインモックのみ）'
)
for f in "${DRAFT_FILES[@]}"; do
  for i in "${!NET_PATTERNS[@]}"; do
    while IFS=: read -r line_num content; do
      echo -e "  ${RED}[ERROR]${NC} $f:$line_num — ${NET_LABELS[$i]}"
      echo -e "         ${content}"
      ERRORS=$((ERRORS + 1))
      DNET1_OK=false
    done < <(grep -nE "${NET_PATTERNS[$i]}" "$f")
  done

  # 外部 URL（許可ドメイン以外）: プロトコル相対 // も対象
  while IFS=: read -r line_num content; do
    stripped=$(echo "$content" \
      | sed 's|https\{0,1\}://fonts\.googleapis\.com||g' \
      | sed 's|https\{0,1\}://fonts\.gstatic\.com||g')
    if echo "$stripped" | grep -qE 'https?://|src=["'\'']//|href=["'\'']//'; then
      echo -e "  ${RED}[ERROR]${NC} $f:$line_num — 外部 URL は fonts.googleapis.com / fonts.gstatic.com のみ許可です"
      echo -e "         ${content}"
      ERRORS=$((ERRORS + 1))
      DNET1_OK=false
    fi
  done < <(grep -nE 'https?://|src=["'\'']//|href=["'\'']//' "$f")
done
$DNET1_OK && echo -e "  ${GREEN}OK${NC}"

# ─────────────────────────────────────────────────────
# [D-CONTENT-1] 絵文字チェック（lint.sh CONTENT-1 と同基準）
#   絵文字は使わず Material Symbols を使う（AGENTS.md）。
#   ピクトグラム絵文字はエラー、⭕❌等の記号絵文字は警告
# ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[D-CONTENT-1] 絵文字チェック${NC} — 絵文字ではなく Material Symbols を使う"

DCONTENT1_OUT=$(python3 - <<'PYEOF'
import glob, html, re

ERROR_PAT = re.compile('[\U0001F000-\U0001FAFF️]')
WARN_PAT = re.compile('[✅❌❤⭐⭕]')

files = sorted(
    glob.glob('drafts/**/*.html', recursive=True)
    + glob.glob('drafts/**/*.js', recursive=True)
    + glob.glob('drafts/**/*.css', recursive=True)
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

DCONTENT1_OK=true
if [ -n "$DCONTENT1_OUT" ]; then
  while IFS=$'\t' read -r level loc msg; do
    [ -n "$level" ] || continue
    if [ "$level" = "ERROR" ]; then
      echo -e "  ${RED}[ERROR]${NC} $loc — $msg"
      ERRORS=$((ERRORS + 1))
    else
      echo -e "  ${YELLOW}[WARN]${NC} $loc — $msg"
      WARNINGS=$((WARNINGS + 1))
    fi
    DCONTENT1_OK=false
  done <<< "$DCONTENT1_OUT"
fi
$DCONTENT1_OK && echo -e "  ${GREEN}OK${NC}"

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
