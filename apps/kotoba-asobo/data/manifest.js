(function () {
  'use strict';

  const sessions = new Map();
  const manifest = [
    {
      id: 'demo',
      unitId: 'demo',
      number: 0,
      title: 'スライドエンジン検証デモ',
      src: 'data/sessions/demo.js',
      isDemo: true,
    },
    {
      id: 'u1s01',
      unitId: 'u1',
      number: 1,
      title: 'ことばであそぼ、開幕',
      src: 'data/sessions/u1s01.js',
    },
    {
      id: 'u1s02',
      unitId: 'u1',
      number: 2,
      title: '気持ちのことば、なんこ持ってる?',
      src: 'data/sessions/u1s02.js',
    },
    {
      id: 'u1s03',
      unitId: 'u1',
      number: 3,
      title: 'オノマトペのふしぎ',
      src: 'data/sessions/u1s03.js',
    },
    {
      id: 'u1s04',
      unitId: 'u1',
      number: 4,
      title: 'にてることば、どこがちがう?',
      src: 'data/sessions/u1s04.js',
    },
    {
      id: 'u1s05',
      unitId: 'u1',
      number: 5,
      title: '反対のことば大集合',
      src: 'data/sessions/u1s05.js',
    },
    {
      id: 'u1s06',
      unitId: 'u1',
      number: 6,
      title: 'ことばのものさし',
      src: 'data/sessions/u1s06.js',
    },
    {
      id: 'u2s08',
      unitId: 'u2',
      number: 8,
      title: '文の主役をさがせ',
      src: 'data/sessions/u2s08.js',
    },
    {
      id: 'u2s09',
      unitId: 'u2',
      number: 9,
      title: '文をもりもり育てよう',
      src: 'data/sessions/u2s09.js',
    },
    {
      id: 'u2s10',
      unitId: 'u2',
      number: 10,
      title: 'ことばの順番マジック',
      src: 'data/sessions/u2s10.js',
    },
    {
      id: 'u2s12',
      unitId: 'u2',
      number: 12,
      title: '文末が気分をきめる',
      src: 'data/sessions/u2s12.js',
    },
    {
      id: 'u3s15',
      unitId: 'u3',
      number: 15,
      title: 'つなぎことばの魔法',
      src: 'data/sessions/u3s15.js',
    },
    {
      id: 'u3s16',
      unitId: 'u3',
      number: 16,
      title: 'それ、どれのこと?',
      src: 'data/sessions/u3s16.js',
    },
    {
      id: 'u3s17',
      unitId: 'u3',
      number: 17,
      title: 'くらべてみると見えてくる',
      src: 'data/sessions/u3s17.js',
    },
    {
      id: 'u3s18',
      unitId: 'u3',
      number: 18,
      title: 'わけと例で伝わる説明',
      src: 'data/sessions/u3s18.js',
    },
    {
      id: 'u4s22',
      unitId: 'u4',
      number: 22,
      title: '漢字のはじまり',
      src: 'data/sessions/u4s22.js',
    },
    {
      id: 'u4s23',
      unitId: 'u4',
      number: 23,
      title: '部首は漢字の家族',
      src: 'data/sessions/u4s23.js',
    },
    {
      id: 'u4s24',
      unitId: 'u4',
      number: 24,
      title: '音よみ・くんよみ探検',
      src: 'data/sessions/u4s24.js',
    },
    {
      id: 'u4s25',
      unitId: 'u4',
      number: 25,
      title: '同じ音のちがう言葉',
      src: 'data/sessions/u4s25.js',
    },
    {
      id: 'u4s26',
      unitId: 'u4',
      number: 26,
      title: '熟語のくみたて工場',
      src: 'data/sessions/u4s26.js',
    },
    {
      id: 'u5s29',
      unitId: 'u5',
      number: 29,
      title: '体のことばの慣用句',
      src: 'data/sessions/u5s29.js',
    },
    {
      id: 'u5s30',
      unitId: 'u5',
      number: 30,
      title: 'ことわざバトル',
      src: 'data/sessions/u5s30.js',
    },
    {
      id: 'u5s31',
      unitId: 'u5',
      number: 31,
      title: '故事成語ものがたり',
      src: 'data/sessions/u5s31.js',
    },
    {
      id: 'u5s32',
      unitId: 'u5',
      number: 32,
      title: 'ていねいな言い方変身術',
      src: 'data/sessions/u5s32.js',
    },
    {
      id: 'u5s33',
      unitId: 'u5',
      number: 33,
      title: 'ところ変わればことば変わる',
      src: 'data/sessions/u5s33.js',
    },
    {
      id: 'u5s34',
      unitId: 'u5',
      number: 34,
      title: '世代でちがう・新しいことば',
      src: 'data/sessions/u5s34.js',
    },
    {
      id: 'u6s36',
      unitId: 'u6',
      number: 36,
      title: '1000年前のことばを聞いてみよう',
      src: 'data/sessions/u6s36.js',
    },
    {
      id: 'u6s37',
      unitId: 'u6',
      number: 37,
      title: '昔のことば・今のことば',
      src: 'data/sessions/u6s37.js',
    },
    {
      id: 'u6s38',
      unitId: 'u6',
      number: 38,
      title: '五・七・五・七・七であそぼう',
      src: 'data/sessions/u6s38.js',
    },
  ];

  window.KotobaAsobo = {
    registerSession(session) {
      if (!session || !session.id) throw new Error('session.id is required');
      sessions.set(session.id, session);
    },
    getSession(id) {
      return sessions.get(id) || null;
    },
    getManifest() {
      return manifest.slice();
    },
  };
}());
