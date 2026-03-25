// チェックインアプリ
// TODO: アプリ仕様が確定したら実装する
// 仕様: apps/checkin/CLAUDE.md を参照

import { generateSessionId, getQueryParam, setQueryParam, escapeHtml, showToast, copyToClipboard } from "../shared/js/utils.js";

const appEl = document.querySelector("#app");

appEl.innerHTML = `
  <div class="card text-center">
    <p class="text-lg text-bold">
      <span class="material-symbols-rounded" style="vertical-align:middle;margin-right:4px">construction</span>準備中
    </p>
    <p class="text-muted mt-sm">チェックインアプリは現在開発中です。</p>
    <a href="../" class="btn btn-ghost mt-md">← ツール一覧へ</a>
  </div>
`;
