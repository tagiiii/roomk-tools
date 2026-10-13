// =============================================
// よく見て漢字（試作）— 見る画面とのつなぎ
//
// 試作は通信しない。同じブラウザでひらいた2つのウィンドウの間だけを
// BroadcastChannel でつなぐ。別の端末どうしではつながらない。
//
// 本体にするときは、このファイルだけを RTDB 版に置きかえる。
// 呼び方（set / get / onValue / onPeer / onEnd / close）は、
// 「1つの木を、パスを指定して書きかえる」形にそろえてある。
// =============================================

const PREFIX = 'yokumite-kanji-draft:';

// パスで指定した場所を書きかえる（'' は木の全体。null は消す）
function apply(tree, path, value) {
  if (!path) return value || {};
  const keys = path.split('/');
  let node = tree;
  for (const key of keys.slice(0, -1)) {
    if (node[key] == null || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  const last = keys[keys.length - 1];
  if (value == null) delete node[last];
  else node[last] = value;
  return tree;
}

// role: 'player'（見せる側）か 'viewer'（見る側）
export function openLink(code, role) {
  const channel = new BroadcastChannel(PREFIX + code);
  const handlers = { value: [], peer: [], end: [] };
  let state = {};
  let peer = false;
  let closed = false;

  const post = (message) => {
    if (!closed) channel.postMessage({ from: role, ...message });
  };
  const setPeer = (on) => {
    if (peer === on) return;
    peer = on;
    handlers.peer.forEach((handler) => handler(on));
  };
  const emit = (path) => handlers.value.forEach((handler) => handler(state, path));

  channel.onmessage = ({ data }) => {
    if (closed || !data || data.from === role) return; // 同じ役どうしはつながない
    if (data.t === 'hello') {
      post({ t: 'here', state: role === 'player' ? state : null });
      setPeer(true);
    } else if (data.t === 'here') {
      if (data.state) {
        state = data.state;
        emit('');
      }
      setPeer(true);
    } else if (data.t === 'set') {
      state = apply(state, data.path, data.value);
      emit(data.path);
    } else if (data.t === 'bye') {
      if (role === 'viewer') state = {}; // 相手がいなくなったら、手元の写しは捨てる（もどってきたら送り直される）
      setPeer(false);
      if (data.end) handlers.end.forEach((handler) => handler());
    }
  };

  // ウィンドウを閉じた・移動した（終わりにはしない。もどれば、またつながる）
  const onHide = () => post({ t: 'bye', end: false });
  window.addEventListener('pagehide', onHide);

  post({ t: 'hello' });

  return {
    // 見せる側だけが書く
    set(path, value) {
      state = apply(state, path, value);
      post({ t: 'set', path, value });
    },
    get: () => state,
    onValue: (handler) => handlers.value.push(handler),
    onPeer: (handler) => handlers.peer.push(handler),
    onEnd: (handler) => handlers.end.push(handler),
    // end が true なら、相手にも「終わり」と伝える
    close(end) {
      if (closed) return;
      post({ t: 'bye', end: Boolean(end) });
      closed = true;
      window.removeEventListener('pagehide', onHide);
      channel.close();
    },
  };
}
