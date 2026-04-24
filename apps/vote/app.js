// 投票・集計アプリ
// TODO: アプリ仕様が確定したら実装する
// 仕様: apps/vote/AGENTS.md を参照

import { generateSessionId, getQueryParam, escapeHtml, showToast } from "../shared/js/utils.js";

const appEl = document.querySelector("#app");

appEl.innerHTML = `
  <div class="card text-center">
    <p class="text-lg text-bold">
      <span class="material-symbols-rounded" style="vertical-align:middle;margin-right:4px">construction</span>準備中
    </p>
    <p class="text-muted mt-sm">投票・集計アプリは現在開発中です。</p>
    <a href="../" class="btn btn-ghost mt-md">← ツール一覧へ</a>
  </div>
`;
