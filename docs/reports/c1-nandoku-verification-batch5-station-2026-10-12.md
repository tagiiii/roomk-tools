# C-1 調査報告: 難読地名・駅名クイズ 第5回・駅名編（2026-10-12）

## 範囲と到達点

- 対象は `nandoku-station` の ns01〜ns20、20問。読み・都道府県や路線や事業者・設問の駅名の表記・解説の主張を棚卸しし、鉄道事業者・自治体・国や県の機関・公立の図書館や博物館などの公開本文と照合した。調査と未承認案の記録のみで、問題データは変更していない。
- 調査開始 HEAD: `f45abea38ac1a6f2f259988312823617457734c8`。
- `apps/quiz/questions.js` SHA-256: `230cdc7173104c0cfc965d035f3bd0669d6399d1ed4687e1511e3b6a3d76d14e`。終了前にも一致を確認。
- 進め方は[第4回](c1-nandoku-verification-batch4-kansai-2026-10-12.md)と同じ。20問を5問ずつ4組に分け、組ごとに別々の調査（AI の下請け調査）で資料を取得した。**指摘が出た ns02・ns05・ns08 の3問は、主担当が根拠のページを取得し直して確かめた。ほかの17問は下請け調査の報告にもとづいており、主担当は資料を取得し直していない。**
- 読みの正答を覆す資料は見つからなかった。路線・事業者・駅名で古くなっているものもなかった。
- **解説が名指しする由来の説が見つからず、公式資料や辞典が別の由来を挙げているのは3問**（ns02 直方・ns05 入善・ns08 越生）。下に未承認の最小案を置く。「その説は存在しない」と否定する資料を得たわけではなく、根拠は「見つからないこと」と「公式・辞典が別の説明をしていること」。
- 表現の精度メモは10問。
- これまでの回と同じく、**20問の全主張について独立した一次資料2件を満たした完了報告ではない**。コトバンク収載の辞典は「辞典」と書いて区別した。
- 参照日は 2026-10-12。JR東日本の駅情報ページ（jreast.co.jp/estation）は 403 で取得できず、同社の時刻表サイトで代えた問がある。

## 人間判断へ渡す事項（解説の由来・3問）

### ns02 直方: 「直賀（なおか）」という古い地名が見つからない

現行の解説は `正解は「のおがた」。古い地名「直賀(なおか)」が変化した、という説があります。`

直方市公式の「市名の由来」に「直賀」「なおか」は出てこない。市の説明は次の2つ。[直方市・市名の由来](https://www.city.nogata.fukuoka.jp/shisei/_1233/_2027.html)（主担当が取得し直して確認）

- 1675年に東蓮寺藩を直方藩と改名した。藩内の小村「直方（能方）村」の読みを取り、『易経』から縁起のよい「直方」の字を当てたといわれる。
- 南北朝時代にこの地方が「王方（のうがた）」と呼ばれたことにちなむ、とも伝えられる。

『日本歴史地名大系』「直方町」（辞典）も、旧称「能方村」から採ったとしている。検索でも「直賀」は見つからなかった。

未承認の最小案は、**市が紹介している説に置き換える**もの。question・choices・正答③・difficulty・ID は現行維持。

```json
{
  "id": "ns02",
  "explanation": "正解は「のおがた」。江戸時代に、近くの村の名前「のうがた」の読みに、縁起のよい「直方」の字を当てたといわれています。"
}
```

### ns05 入善: 「入野（にゅうの）」という古い地名が見つからない

現行の解説は `正解は「にゅうぜん」。古い地名「入野(にゅうの)」と人名にちなむ説など、由来には諸説あります。`

- 入善町公式は、12世紀前半に東大寺の荘園「入善荘」が成立したと書いている。町名の由来そのものは書いていない。[入善町・概要](https://www.town.nyuzen.toyama.jp/gyosei/chosei/gaiyo/2/2629.html)（主担当が取得し直して確認）
- 『日本歴史地名大系』「入膳村」（辞典）は、もとは金沢と称したが加賀の金沢とまぎらわしく、近辺を入膳郷と称していたので入膳村とした、という1704年の書上を紹介している。「入野」は出てこない。[コトバンク経由](https://kotobank.jp/word/%E5%85%A5%E8%86%B3%E6%9D%91-3050666)（主担当が取得し直して確認）
- 人名説は個人ブログにあるだけで、一次資料・辞典では確認できていない。

未承認の最小案は、**確認できた事実（古い荘園の名前）だけにする**もの。question・choices・正答②・difficulty・ID は現行維持。

```json
{
  "id": "ns05",
  "explanation": "正解は「にゅうぜん」。平安時代の終わりごろに東大寺の荘園「入善荘」がつくられた、古くからある地名です。"
}
```

12世紀前半は平安時代の後期にあたる（辞典は大治年間〈1126〜31年〉としている）。

### ns08 越生: 「見越す」説が見つからず、町は「尾根越し」説を有力としている

現行の解説は `正解は「おごせ」。峠の向こうを「見越す」地形にちなむ、という説など、由来には諸説あります。`

越生町公式は、語源には諸説あるとしたうえで、秩父へも上州へも尾根や峠を越えなければならないことに由来する「尾根越し（おねごし）」の「尾越し（おごし）」から変化したという説が有力視されている、と書いている。「見越す」という言葉は出てこない。[越生町・町の紹介](https://www.town.ogose.saitama.jp/kamei/somu/jichishinko/gyomuannai/gaiyo/1450931886977.html)（主担当が取得し直して確認）。東武鉄道の広報誌も「尾根を越える地」が変化したと紹介している。検索でも「見越す」説は見つからなかった。

未承認の最小案は、**町が有力とする説に置き換える**もの。question・choices・正答③・difficulty・ID は現行維持。

```json
{
  "id": "ns08",
  "explanation": "正解は「おごせ」。尾根や峠を越える「尾根越し」が変化した、という説など、由来には諸説あります。"
}
```

## 精度メモ（誤りとは扱わない。判断待ちへは起票しない）

P-2 の決着（「誤りではなく表現の精密さ」は報告書に記載するのみ）に従う。

| ID | 現行の表現 | 取得資料とのずれ |
|---|---|---|
| ns03 国府津 | 相模国の役所「国府」の港があった地 | 辞典に広く載る説。県立歴史博物館の講演資料は、郡の港「郡津」が転じたという別の説を示す。辞典にも「不詳」とするものがある。 |
| ns06 醒ヶ井 | 設問の表記「醒ヶ井」／病から醒めた | JR東海と米原市の表記は大きいケの「醒ケ井」（同じパックの ns09 は「各務ケ原」と大きいケ）。回復したものは資料により「高熱」「傷」「正気を失った状態」。 |
| ns07 雑色 | 平安時代の下級役人「雑色」が住んだ地 | 「雑色」という役人は辞典で確認（平安時代に限らない）。その人々が住んだという説を紹介する一次資料は未取得。 |
| ns09 各務ケ原 | 駅名と市名の読みが異なる珍しい例 | 読みの違いは JR東海と各務原市で確認。「珍しい」を裏づける資料はない。 |
| ns10 田原坂 | 「田原」は古くからこの地に伝わる名前 | 旧村名や遺跡名として「田原」があることは確認。いつからの地名かを述べた資料は未取得。 |
| ns12 谷保 | もとは「やぼ」だったが、「野暮」を避けて「やほ」に変えた | 都立図書館は江戸時代から「やほ／やぼ」を併記。「野暮を避けた」説は一次資料で未取得。 |
| ns13 酒々井 | 父に酒を汲み続けた孝行息子の井戸から酒が湧いた | 町の資料では、息子は酒を買って飲ませており、ある日古い井戸から酒が出た、という順。町は別の説明（湧き水の「出水」に「酒」の字を当て、あとから伝説がついた）も載せている。 |
| ns14 大甕 | 近くの大甕神社にちなむ地名 | 市の施設の資料が書いているのは「神名の甕星に由来」。「神社にちなむ」と書いた一次資料は未取得。 |
| ns16 男衾 | 奈良時代に置かれた郡名 | 東武鉄道がそう紹介。熊谷市と辞典で確かめられるのは「奈良時代に郡があった」ことまで。 |
| ns17 波久礼 | 崩れる地形「崩れ（はくずれ）」 | 隣の長瀞町の地名「破崩（はぐれ）」は崩れやすい場所の意味と説明されている。波久礼に当てた一次資料と、「はくずれ」という読みは未取得。 |

## 20問の取得範囲と残る確認

リンクは、特記したものを除き下請け調査が本文を取得した資料。

| ID・現行の正答 | 設問・解説に対する支持範囲と資料 | 残る確認・判定の限界 |
|---|---|---|
| ns01 大歩危・①おおぼけ | [JR四国・大歩危駅](https://www.jr-shikoku.co.jp/01_trainbus/kakueki/oboke/)に読みと所在地。[徳島県・大歩危小歩危](https://www.pref.tokushima.lg.jp/japanese/tourism/spot/ooboke-koboke)に断崖を意味する古語の説。 | 「歩危」は「ぼけ／ほけ」への当て字で、「ほき」は同じ意味の別の形。駅の改称年は一次資料で未取得。 |
| ns02 直方・③のおがた | [JR九州・直方駅](https://www.jrkyushu.co.jp/railway/station/1191764_1601.html)に読み。[直方市・市名の由来](https://www.city.nogata.fukuoka.jp/shisei/_1233/_2027.html)。 | 上の判断事項。『直方市史』は未取得。 |
| ns03 国府津・②こうづ | [JR東日本・時刻表](https://www.jreast-timetable.jp/timetable/list0665.html)に読みと東海道線。[神奈川県立歴史博物館の講演資料](https://www.pref.kanagawa.jp/documents/95200/r5isekiten-kouenkai3.pdf)。 | 上の精度メモ。小田原市の由来の説明は未取得。 |
| ns04 弘明寺・①ぐみょうじ | [京急電鉄・弘明寺駅](https://www.keikyu.co.jp/ride/kakueki/KK43.html)と[横浜市交通局・弘明寺駅](https://navi.hamabus.city.yokohama.lg.jp/koutuu/pc/detail/Station?id=00002410)に読み。両方に「弘明寺」駅がある。[横浜市南区](https://www.city.yokohama.lg.jp/minami/shokai/gaiyo/kamakuraera.html)に「横浜最古と称される」。 | 区は「称される」と留保。寺自身は実際の開山を1044年ごろと見ている。 |
| ns05 入善・②にゅうぜん | [あいの風とやま鉄道・入善駅](https://ainokaze.co.jp/station/nyuzen)に読み。[入善町・概要](https://www.town.nyuzen.toyama.jp/gyosei/chosei/gaiyo/2/2629.html)。 | 上の判断事項。『入善町史』は未取得。 |
| ns06 醒ヶ井・②さめがい | [米原市・醒井地蔵川の梅花藻](https://www.city.maibara.lg.jp/soshiki/keizai_kankyo/shoko_kanko/kanko_info/spot/14398.html)に読みと表記。[文化庁・日本遺産ポータル](https://japan-heritage.bunka.go.jp/ja/culturalproperties/result/163/)に日本武尊の伝承。 | 上の精度メモ。 |
| ns07 雑色・③ぞうしき | [京急電鉄・雑色駅](https://www.keikyu.co.jp/ride/kakueki/KK18.html)に読みと本線。 | 上の精度メモ。大田区史などは未取得。 |
| ns08 越生・③おごせ | [JR東日本・時刻表](https://timetables.jreast.co.jp/timetable/list0374.html)に読みと八高線。[東武鉄道・越生駅](https://www.tobu.co.jp/railway/guide/station/info/8112/)に越生線。[越生町・町の紹介](https://www.town.ogose.saitama.jp/kamei/somu/jichishinko/gyomuannai/gaiyo/1450931886977.html)。 | 上の判断事項。 |
| ns09 各務ケ原・②かがみがはら | [JR東海・駅マスタ](https://traininfo.jr-central.co.jp/zairaisen/data/hp_eki_master_ja.json)に読みと高山線。[各務原市・キッズページ](https://www.city.kakamigahara.lg.jp/kodomo/1011466/1011504.html)に市の読み。 | 上の精度メモ。 |
| ns10 田原坂・②たばるざか | [JR九州・田原坂駅](https://www.jrkyushu.co.jp/railway/station/1191681_1601.html)に読み。[熊本市・田原坂西南戦争資料館](https://www.city.kumamoto.jp/kiji00316402/index.html)に激戦地。 | 上の精度メモ。下請け調査は、JR九州のサイトに熊本の地震に関するお知らせがあったと報告している（主担当は未確認。設問の正誤には関係しない）。 |
| ns11 分倍河原・③ぶばいがわら | [JR東日本・時刻表](https://timetables.jreast.co.jp/timetable/list1385.html)と[京王電鉄・駅構内マップ](https://www.keio.co.jp/train/station/station_map/pdf/ko25_bubaigawara.pdf)に読み。両方に同名の駅がある。 | 「鎌倉時代から」の根拠は辞典が中心。現在の町名は「分梅町」。 |
| ns12 谷保・③やほ | [JR東日本・時刻表](https://timetables.jreast.co.jp/timetable/list1599.html)に読みと南武線。[東京都立図書館](https://www.library.metro.tokyo.lg.jp/portals/0/edo/tokyo_library/modal/index.html?d=5591)。 | 上の精度メモ。 |
| ns13 酒々井・③しすい | [JR東日本・時刻表](https://timetables.jreast.co.jp/timetable/list0781.html)に読みと成田線。[酒々井町・酒の井の伝説](https://www.town.shisui.chiba.jp/docs/2014021804927/)。 | 上の精度メモ。 |
| ns14 大甕・③おおみか | [JR東日本・時刻表](https://timetables.jreast.co.jp/timetable/list0348.html)に読みと常磐線。[日立市視聴覚センター通信](https://www.lib.city.hitachi.lg.jp/manage/contents/upload/65e55a994c6d7.pdf)。 | 上の精度メモ。現在の町名は「大みか町」。 |
| ns15 九品仏・③くほんぶつ | [東急電鉄・九品仏駅](https://www.tokyu.co.jp/area/kuhombutsu/station/)に読みと大井町線。[世田谷区・浄真寺](https://www.city.setagaya.lg.jp/02059/3400.html)に9体の阿弥陀仏。 | 「九品仏」は町名ではなく、駅名・地区名・寺の通称。残る確認なし。 |
| ns16 男衾・③おぶすま | [東武鉄道・男衾駅](https://www.tobu.co.jp/railway/guide/station/info/7506/)に読み・東上線・由来。[熊谷デジタルミュージアム](https://www.kumagaya-bunkazai.jp/museum/dokusyo/timei/obusuma.htm)。 | 上の精度メモ。 |
| ns17 波久礼・③はぐれ | [秩父鉄道・波久礼駅](https://www.chichibu-railway.co.jp/station/19_hagure.html)に読み。[秩父まるごとジオパーク](https://www.chichibu-geo.com/geosite/bunka08/)に「破崩」。 | 上の精度メモ。 |
| ns18 南蛇井・③なんじゃい | [上信電鉄・南蛇井駅](https://www.joshin-dentetsu.co.jp/station/31/)に読み。[国土交通省関東運輸局・珍しい駅名](https://wwwtb.mlit.go.jp/kanto/content/000262324.pdf)に「ナサイ」の説と当て字。 | 史料で確かめられる古い地名は「那射（なさ）」。残る確認なし。 |
| ns19 神戸・③ごうど | [わたらせ渓谷鐵道・沿革](https://www.watetsu.com/company/history.php)に神土から神戸への改称（1989年）。[みどり市](https://www.city.midori.gunma.jp/kosodate/1001647/1001800/1002430/1002500.html)に混同を避けた理由。 | 事業者・市・国の機関の3つで一致。残る確認なし。 |
| ns20 飯給・③いたぶ | [小湊鐵道・飯給駅](https://www.kominato.co.jp/station/itabu/)に読み。[市原歴史博物館・白山神社](https://www.imuseum.jp/field_museum/1/coursserch/satomitsukizaki/1148.html)に大友皇子の伝説。 | 下請け調査は、駅のある区間が台風の被害で運休中と報告している（主担当は未確認。駅は廃止されていない）。 |

## 次の対象

ローテーションの次は `nandoku-kyushu`（九州・沖縄編）20問。
