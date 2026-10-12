# C-1 調査報告: 難読地名・駅名クイズ 第6回・九州沖縄（2026-10-12）

## 範囲と到達点

- 対象は `nandoku-kyushu` の nq01〜nq20、20問。読み・自治体や駅の帰属・設問の表記・解説の主張を棚卸しし、自治体・鉄道事業者・国や県の機関・公立の図書館や博物館などの公開本文と照合した。調査と未承認案の記録のみで、問題データは変更していない。
- 調査開始 HEAD: `4198f24436615f4e94305530ceae198a03bf3590`。
- `apps/quiz/questions.js` SHA-256: `0c88d9879ba25322a070fa3a8efd2c07ee0e478071d4918c48c2bb7c7b2396a8`。終了前にも一致を確認。
- 進め方は[第5回](c1-nandoku-verification-batch5-station-2026-10-12.md)と同じ。20問を5問ずつ4組に分け、組ごとに別々の調査（AI の下請け調査）で資料を取得した。**指摘が出た nq07・nq19 の2問は、主担当が根拠のページを取得し直して確かめた。ほかの18問は下請け調査の報告にもとづいており、主担当は資料を取得し直していない。**
- 読みの正答を覆す資料は見つからなかった。自治体・路線・駅名で古くなっているものもなかった（合併後の市名は、設問がすでに現在の市名で書いている）。
- **解説の中のふりがなが資料と合わなかったのは2問**（nq07 都城の「都島」、nq19 安心院の「あしふ」）。下に未承認の最小案を置く。
- 表現の精度メモは9問。
- これまでの回と同じく、**20問の全主張について独立した一次資料2件を満たした完了報告ではない**。コトバンク収載の辞典は「辞典」と書いて区別した。
- 参照日は 2026-10-12。

## 人間判断へ渡す確定事項（解説のふりがな・2問）

### nq07 都城: 「都島」のふりがなは「みやこじま」

現行の解説は `正解は「みやこのじょう」。市の説明では、古い地名「都島(みやこのしま)」にあった城「都之城」が由来とされています。`

都城市の文化財のページは「都島（みやこじま）」とふりがなを付けている。[都城市・都城跡](https://www.city.miyakonojo.miyazaki.jp/site/bunkazai/1716.html)（主担当が取得し直して確認）。下請け調査によると、『日本歴史地名大系』（辞典）と日本郵便の町名（都島町＝ミヤコジマチョウ）も同じ読みで、「みやこのしま」と読む資料は見つかっていない。

由来の筋（都島にある城なので「みやこのじょう」と呼び、それが地名になった）は、都城島津邸のページの説明どおり。[都城市・都城島津邸](https://www.city.miyakonojo.miyazaki.jp/site/shimazu/9102.html)（主担当が取得し直して確認）

未承認の最小案は、**ふりがなだけを直す**もの。question・choices・正答③・difficulty・ID は現行維持。

```json
{
  "id": "nq07",
  "explanation": "正解は「みやこのじょう」。市の説明では、古い地名「都島(みやこじま)」にあった城「都之城」が由来とされています。"
}
```

市のページは都島を「城の中の小さな山」と説明しており、「古い地名」は辞典（古来から都島と称していた）にもとづく言い方。ここは変えない。

### nq19 安心院: 「あしふ」は、辞典では「あしぶ」

現行の解説は `正解は「あじむ」。湿地に生えるアシが茂る場所を意味する「あしふ」が変化して、この読み方になったといわれています。`

コトバンクの「安心院」の項では、ふりがなを載せている2つの辞典（日本大百科全書の「蘆生」、マイペディアの「葦生」）がどちらも **「あしぶ」**。「あしふ」と書く辞典はない。[コトバンク・安心院](https://kotobank.jp/word/%E5%AE%89%E5%BF%83%E9%99%A2-25344)（主担当が取得し直して確認）。下請け調査によると、『日本歴史地名大系』「安心院町」も「葦生（あしぶ）」としている。

未承認の最小案は、**ふりがなだけを直す**もの。question・choices・正答②・difficulty・ID は現行維持。

```json
{
  "id": "nq19",
  "explanation": "正解は「あじむ」。湿地に生えるアシが茂る場所を意味する「あしぶ」が変化して、この読み方になったといわれています。"
}
```

辞典の言い方は「湖の跡」「湖が干上がった干潟」で、「湿地」は言い換え。宇佐市や大分県の公式ページでこの説を紹介するものは見つかっていない（発信元は辞典のみ）。

## 精度メモ（誤りとは扱わない。判断待ちへは起票しない）

P-2 の決着（「誤りではなく表現の精密さ」は報告書に記載するのみ）に従う。nq06・nq08・nq13 は、解説が挙げる説を裏づける資料が見つからなかったが、公式資料や辞典が**別の由来を挙げているわけではない**（由来そのものに触れていない）ので、第5回の3問とは区別してメモにとどめる。

| ID | 現行の表現 | 取得資料とのずれ |
|---|---|---|
| nq02 喜入 | 由来には諸説あります | 鹿児島市は、1414年に島津久豊が戦勝を祝って「給黎」を「喜入」に改めたと、1つの経緯で説明している。複数の説を並べた資料は未取得。 |
| nq03 笹原 | 九州北部に多い「ばる」は「原」を意味し | 「原」を「はる／ばる」と読む地名が多いことは確認。図書館の回答は、開墾地を表す「ハル（治・墾）」に由来するとしている。分布は九州全域と沖縄に及ぶ。 |
| nq04 不知火 | 怪火にちなむ古い地名 | 不知火村の発足は明治22年。古いのは怪火の伝承（『日本書紀』）のほう。 |
| nq05 杵築 | 由来には諸説ありますが | 市も辞典も、1712年の朱印状で「木付」が「杵築」と書かれたという1つの説明で一致。「きつき」（木付）の読みは中世からある。 |
| nq06 嘉手納 | 古い按司の領地名にちなむ、という説 | この説を載せた資料は未取得。町の公式ページと辞典は語源に触れていない。報道は「由来は定かでない」として別の説を紹介。 |
| nq08 折生迫 | 由来には諸説あります | 由来を説明する資料そのものが未取得。 |
| nq13 松橋 | かつてあった海峡が「松葉の瀬戸」と呼ばれ | この説は一次資料・辞典で未取得（出典のないウェブ記事のみ）。宇城市と辞典が書いているのは「入り江だった・海面下だった」まで。明治期の本に「松葉瀬」という表記は見つかっている。 |
| nq17 生月 | 航海の途中でこの島を見つけ | 国と県のページは「ほっとひと息ついた」説を紹介。観光サイトは帰り道の話としている。 |
| nq20 頴娃 | 「娃」は読まずに添えられている字 | 辞典で確認できるのは「もとは『エ』の1音で、2文字で書くようになった」まで。「娃を読まない」と明記した資料は未取得。 |

## 20問の取得範囲と残る確認

リンクは、特記したものを除き下請け調査が本文を取得した資料。

| ID・現行の正答 | 設問・解説に対する支持範囲と資料 | 残る確認・判定の限界 |
|---|---|---|
| nq01 飫肥・②おび | [JR九州・飫肥駅](https://www.jrkyushu.co.jp/railway/station/1191482_1601.html)に読み。[日南市・飫肥伝統的建造物群保存地区](https://www.city.nichinan.lg.jp/soshikikarasagasu/shogaigakushuka/2/817.html)に伊東家の城下町。 | 「古くから残る地名」は辞典（『和名抄』の飫肥郷）による。 |
| nq02 喜入・①きいれ | [JR九州・喜入駅](https://www.jrkyushu.co.jp/railway/station/1191524_1601.html)に読み。[鹿児島市・喜入町](https://www.city.kagoshima.lg.jp/kikakuzaisei/kikaku/seisaku-s/shise/shokai/box-02/kire.html)に1414年の改称。 | 上の精度メモ。喜入町は2004年に鹿児島市へ合併（設問は「鹿児島県の」としており影響なし）。 |
| nq03 笹原・②ささばる | [JR九州・笹原駅](https://www.jrkyushu.co.jp/railway/station/1191592_1601.html)に読み。[福岡市・町名一覧](https://www.city.fukuoka.lg.jp/shimin/kusei/life/documents/jyukyohyouji20230626.pdf)に「ばる」「はる」の町名。 | 上の精度メモ。 |
| nq04 不知火・①しらぬい | [宇城市・不知火及び水島](https://www.city.uki.kumamoto.jp/kankobunka/bunka/2268781)に読みと怪火の説明。[環境省・八代海](https://www.env.go.jp/water/heisa/heisa_net/waters/yatusirokai.html)に別名の不知火海。 | 上の精度メモ。 |
| nq05 杵築・①きつき | [JR九州・杵築駅](https://www.jrkyushu.co.jp/railway/station/1191533_1601.html)に読み。[杵築市・杵築城](https://www.city.kitsuki.lg.jp/soshiki/7/bunka/bunkazai/bunkazai/1823.html)に城下町と朱印状の話。 | 上の精度メモ。 |
| nq06 嘉手納・②かでな | [嘉手納町・歴史](https://www.town.kadena.okinawa.jp/kadena/history.html)に町の現存と沿革。 | 上の精度メモ。『嘉手納町史』は未取得。 |
| nq07 都城・③みやこのじょう | [JR九州・都城駅](https://www.jrkyushu.co.jp/railway/station/1191903_1601.html)に読み。[都城市・都城跡](https://www.city.miyakonojo.miyazaki.jp/site/bunkazai/1716.html)。 | 上の確定事項。 |
| nq08 折生迫・③おりゅうざこ | [JR九州・折生迫駅](https://www.jrkyushu.co.jp/railway/station/1191484_1601.html)に読み。[宮崎市・青島の隆起海床](https://www.city.miyazaki.miyazaki.jp/culture/art/207.html)に青島の近くの地名。 | 上の精度メモ。住所の読みは、日本郵便では「オリウザコ」（設問は駅名を聞いている）。 |
| nq09 勢理客・③じっちゃく | [浦添市・下水道台帳](https://www.city.urasoe.lg.jp/doc/609e84363d59ae2434bffc1a/)に読み。[日本歴史地名大系・コトバンク経由](https://kotobank.jp/word/%E5%8B%A2%E7%90%86%E5%AE%A2%E6%9D%91-3107618)に古い表記（辞典）。 | 同じ字の地名は今帰仁村・伊是名村にもあり、そちらの読みは「せりきゃく」。残る確認なし。 |
| nq10 保栄茂・②びん | [豊見城市・保栄茂グスク](https://www.city.tomigusuku.lg.jp/soshiki/8/1035/gyomuannai/3/2/1/354.html)に読み。[豊見城市史だより 第12号](https://www.city.tomigusuku.lg.jp/material/files/group/36/BUNKA2014h26SISI_dayori_12_2.pdf)に音の変化の説。 | 市の資料は、「ビン」がもとの呼び名で漢字が後から当てられたという見方も併記している。 |
| nq11 知覧・②ちらん | [南九州市・知覧麓](https://www.city.minamikyushu.lg.jp/sport_bunka_kyoiku/rekishi_bunkazai/2/3/4166.html)に知覧島津氏の私領地と麓。[文化庁・知覧城跡](https://online.bunka.go.jp/db/heritages/detail/211690)。 | 市・国・県の3つで一致。残る確認なし。 |
| nq12 西戸崎・②さいとざき | [JR九州・西戸崎駅](https://www.jrkyushu.co.jp/railway/station/1191585_1601.html)に読み。[福岡市・西戸崎校区](https://fukucomi.city.fukuoka.lg.jp/school/detail/3)に石炭積出港。 | 独立した2つの発信元で確認。残る確認なし。 |
| nq13 松橋・②まつばせ | [JR九州・松橋駅](https://www.jrkyushu.co.jp/railway/station/1191871_1601.html)に読み。[宇城市・位置と地勢](https://www.city.uki.kumamoto.jp/toppage/gaiyo/shokai/2020532)に干拓以前の入り江。 | 上の精度メモ。『松橋町史』は未取得。駅の所在地は宇城市不知火町。 |
| nq14 都農・②つの | [JR九州・都農駅](https://www.jrkyushu.co.jp/railway/station/1191708_1601.html)に読み。[柴田博子「8・9世紀の日向」](https://miyasankei-u.repo.nii.ac.jp/record/515/files/kenkyukiyo_29_1_p23.pdf)に『延喜式』の都農神社と都濃野馬牧。 | 『延喜式』に出るのは神社名と牧の名。残る確認なし。 |
| nq15 厳木・②きゅうらぎ | [JR九州・厳木駅](https://www.jrkyushu.co.jp/railway/station/1191541_1601.html)に読み。[柳田國男『地名の研究』](https://www.aozora.gr.jp/cards/001566/files/58544_68749.html)に「清ら木」の説。 | 辞典も「諸説がある」としている。残る確認なし。 |
| nq16 相知・②おうち | [JR九州・相知駅](https://www.jrkyushu.co.jp/railway/station/1191453_1601.html)に読みと唐津線。[文化庁・100年フード](https://www.bunka.go.jp/seisaku/shokubunka/foodculture/hyakunenfood/jirei/list_saga.html)に相知高菜漬。 | 相知高菜は一度途絶えて、2009年に漬物が復活した品種。残る確認なし。 |
| nq17 生月・②いきつき | [平戸市・文化財保存活用地域計画](https://www.city.hirado.nagasaki.jp/kurashi/culture/bunka/kihonkoso/files/2dai2.pdf)に読み。[国土交通省・道の駅 生月大橋](https://www.qsr.mlit.go.jp/n-michi/michi_no_eki/kobetu/ikitsuki/ikitsuki.html)に遣唐使の説。 | 上の精度メモ。平戸市の博物館は、839年の『続日本後紀』の「生属島」を最古の記録として挙げる。 |
| nq18 東彼杵・②ひがしそのぎ | [東彼杵町・そのぎ茶](https://www.town.higashisonogi.lg.jp/soshiki/sangyoushinkou/1/3/sonogicha/3527.html)に読み。[農林水産省・茶の資料](https://www.maff.go.jp/j/seisan/tokusan/cha/attach/pdf/ocha-43.pdf)にそのぎ茶。 | 残る確認なし。 |
| nq19 安心院・②あじむ | [大分県・地形と地質の資料](https://www.pref.oita.jp/uploaded/attachment/2113909.pdf)に読み。[コトバンク・安心院](https://kotobank.jp/word/%E5%AE%89%E5%BF%83%E9%99%A2-25344)（辞典）。 | 上の確定事項。 |
| nq20 頴娃・②えい | [JR九州・頴娃駅](https://www.jrkyushu.co.jp/railway/station/1191444_1601.html)に読み。[南九州市・頴娃の方言](https://www.city.minamikyushu.lg.jp/sport_bunka_kyoiku/rekishi_bunkazai/2/1/9517.html)に独特の方言。 | 上の精度メモ。 |

## 次の対象

ローテーションの次は `nandoku-chushi`（中国・四国編）20問。
