/* 麻雀の効果音と声（はじめは切。この端末だけで鳴る。2026-11-15 オーナー依頼）
   ・音は sfx/{名前}.mp3（ElevenLabs で作った。効果音は scripts/mahjong/sfx.py、声は scripts/mahjong/voice.py）。
     「入」にした端末だけが読む（切の人は通信しない）。読めていない音は Web Audio の合成音（SYNTH）で鳴る。
   ・ブラウザの決まりで、何かを押したあとでないと鳴らせない（ensure を押したときに呼ぶ）。
   ・失敗の音は作らない。 */
(function (root) {
  'use strict';
  const KEY = 'mahjong:sfx';
  const GAIN = 0.3;
  // 名前と大きさ。ファイルを変えたら VER を上げる
  const FILES = {
    deal: 0.6, discard: 0.7, pick: 0.35, turn: 0.55, win: 0.75, draw: 0.6, dora: 0.6,
    'v-ron': 1, 'v-tsumo': 1, 'v-pon': 1, 'v-chi': 1, 'v-kan': 1, 'v-riichi': 1,
  };
  // 声のファイル（scripts/mahjong/voice.py で作った）を読むか。false のあいだは合成音で鳴る
  const VOICE_FILES = true;
  const VER = '20261115b';
  const S = { on: false, ac: null, out: null, noise: null, buf: {}, loading: false };
  try { S.on = localStorage.getItem(KEY) === '1'; } catch (e) { /* 使えなければ切のまま */ }

  function load() {
    if (S.loading || !S.ac) return;
    S.loading = true;
    Object.keys(FILES).forEach((name) => {
      if (name.startsWith('v-') && !VOICE_FILES) return;
      fetch('sfx/' + name + '.mp3?v=' + VER)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => S.ac.decodeAudioData(data))
        .then((buf) => { S.buf[name] = buf; })
        .catch(() => { /* 読めなければ合成音のまま */ });
    });
  }

  function ensure() {
    if (!S.on) return;
    try {
      if (!S.ac) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return;
        S.ac = new AC({ latencyHint: 'interactive' });
        S.out = S.ac.createGain();
        S.out.gain.value = GAIN;
        S.out.connect(S.ac.destination);
        load();
      }
      if (S.ac.state !== 'running') S.ac.resume().catch(() => {});
    } catch (e) { /* 鳴らせなくても遊べる */ }
  }

  function tone(freq, when, level, decay, type = 'sine', to = 0) {
    const ac = S.ac;
    const t = ac.currentTime + when;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (to) {
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(to, t + decay);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(S.out);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  function hiss(when, level, decay, from) {
    const ac = S.ac;
    if (!S.noise) {
      S.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = S.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime + when;
    const src = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    src.buffer = S.noise;
    f.type = 'bandpass';
    f.frequency.value = from;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(S.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  // 合成音（ファイルが読めていない音はこれで鳴る）
  const call = (notes) => () => notes.forEach(([f, w]) => tone(f, w, 0.32, 0.14, 'triangle'));
  const SYNTH = {
    deal: () => { for (let i = 0; i < 6; i += 1) hiss(i * 0.07, 0.25, 0.05, 2500 + i * 200); },
    discard: () => { hiss(0, 0.45, 0.05, 3200); tone(420, 0, 0.18, 0.05, 'triangle'); },
    pick: () => tone(1100, 0, 0.12, 0.03, 'triangle'),
    turn: () => { tone(660, 0, 0.25, 0.14); tone(880, 0.1, 0.25, 0.2); },
    win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.32, 0.3)); tone(1319, 0.38, 0.25, 0.5); },
    draw: () => { tone(659, 0, 0.25, 0.25); tone(587, 0.16, 0.25, 0.25); tone(523, 0.32, 0.25, 0.45); },
    dora: () => { tone(1319, 0, 0.2, 0.12, 'triangle', 1760); tone(1760, 0.08, 0.18, 0.25); },
    'v-ron': call([[784, 0], [1047, 0.08]]),
    'v-tsumo': call([[659, 0], [1047, 0.08]]),
    'v-pon': call([[523, 0], [523, 0.09]]),
    'v-chi': call([[587, 0], [784, 0.09]]),
    'v-kan': call([[392, 0], [523, 0.09], [392, 0.18]]),
    'v-riichi': call([[523, 0], [659, 0.08], [784, 0.16]]),
  };

  function play(name, when = 0) {
    if (!S.on || !S.ac || S.ac.state !== 'running' || !SYNTH[name]) return;
    if (S.buf[name]) {
      const src = S.ac.createBufferSource();
      const g = S.ac.createGain();
      src.buffer = S.buf[name];
      g.gain.value = FILES[name] || 1;
      src.connect(g).connect(S.out);
      src.start(S.ac.currentTime + when);
      return;
    }
    if (when) setTimeout(() => { if (S.on && S.ac.state === 'running') SYNTH[name](); }, when * 1000);
    else SYNTH[name]();
  }

  function setOn(on) {
    S.on = !!on;
    try { localStorage.setItem(KEY, S.on ? '1' : '0'); } catch (e) { /* 残せなくてもよい */ }
    if (S.on) {
      ensure();
      // 入にしたら、どんな音か1回だけ聞かせる
      setTimeout(() => play('discard'), 60);
    }
  }

  root.MahjongSound = { play, setOn, ensure, isOn: () => S.on };
})(window);
