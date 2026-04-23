// ことば探偵
// TODO: 移植中。仕様: apps/codenames/AGENTS.md を参照
// 移植元: https://github.com/tagiiii/codename_game （codename_game/src/）

import { escapeHtml } from "../shared/js/utils.js";
import { wordSets } from "./words.js";

// 疎通確認用の import。実装時に使用する。
void escapeHtml;

const appEl = document.querySelector("#app");

appEl.innerHTML = `
  <div class="card text-center">
    <p class="text-lg text-bold">
      <span class="material-symbols-rounded" style="vertical-align:middle;margin-right:4px">construction</span>準備中
    </p>
    <p class="text-muted mt-sm">ことば探偵は現在移植中です。</p>
    <p class="text-muted mt-xs">単語セット ${wordSets.length} 種を読み込みました。</p>
    <a href="../" class="btn btn-ghost mt-md">← ツール一覧へ</a>
  </div>
`;
