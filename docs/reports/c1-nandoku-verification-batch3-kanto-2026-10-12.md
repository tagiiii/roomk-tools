# C-1 調査報告: 難読地名・駅名クイズ 第3回・関東甲信越（2026-10-12）

## 範囲と到達点

- 対象は `nandoku-kanto` の kk01〜kk20、20問。読み・自治体や駅の帰属・解説の主張を棚卸しし、自治体・鉄道事業者・国や県の機関・公立の図書館や博物館などの公開本文と照合した。調査と未承認案の記録のみで、問題データは変更していない。
- 調査開始 HEAD: `f29b76fe05c7ea76f72eb170f1fd82ef6fab3fbe`。
- `apps/quiz/questions.js` SHA-256: `0cd59ebe06ae71c0eab413d14b0295f62adab7b934d3338c7615e3f3fecc0fa1`。終了前にも一致を確認。
- 進め方: 20問を5問ずつ4組に分け、組ごとに別々の調査（AI の下請け調査）で資料を取得した。**「事実誤認の疑い」と出た kk11・kk07 の2問は、主担当が根拠のページを取得し直して確かめた。ほかの18問は下請け調査の報告にもとづいており、主担当は資料を取得し直していない。**
- 読みの正答を覆す資料は見つからなかった。自治体・駅の帰属で古くなっているものもなかった。
- 解説が取得資料と食い違ったのは **kk11（五霞）の年** と **kk07（邑楽）の時代** の2件。下に未承認の最小案を置く。
- [第2回](c1-nandoku-verification-batch2-2026-09-08.md)と同じく、**20問の全主張について独立した一次資料2件を満たした完了報告ではない**。同じ発信元の別ページは1件と数えた。由来の説は「その説が紹介されている」範囲の支持であり、歴史的な正しさの立証とは区別する。
- 参照日は 2026-10-12。JR東日本の駅情報ページ（jreast.co.jp/estation）は一部の取得手段で 403 になり、同社の時刻表ページで代えた問がある。

## 人間判断へ渡す確定事項

### kk11 五霞: 「1987年まで」が町の年表と合わない

現行の解説は `正解は「ごか」。茨城県で唯一、利根川の南側にある町で、1987年まで茨城本土と陸続きの道路がなかった珍しい地理でも知られています。`

五霞町公式の年表では、利根川を渡る **新国道4号・新利根川橋の開通は1981年（昭和56年）**。1987年（昭和62年）の欄にあるのは「大平橋が開通」「役場窓口の業務が電算化」「第一回村民ウォークラリー」で、利根川を渡る橋の記載はない。[五霞町・年表でみる町の歴史](https://www.town.goka.lg.jp/kurashi-machi-shigoto/gokanabi/youkoso/town-profile/town-history/page000012.html)（主担当が取得し直して確認）

- 「茨城県で唯一、利根川の南側」は、町の総合計画が「茨城県で唯一利根川の右岸に位置」と書いている。[第6次五霞町総合計画](https://www.town.goka.lg.jp/data/doc/1586918069_doc_41_0.pdf)。「南側」は言い換え。
- 「新利根川橋ができるまで、県内のほかの市町村と直接結ぶ道路がなかった」こと自体を明記した一次資料は取得できていない（Wikipedia と報道記事のみ）。1987年の「大平橋」がどの川の橋かも未確認。
- 町は今も四方を川に囲まれており、「陸続き」は橋でつながったことの言い換えになる。

未承認の最小案は、**年と道路の話を外す**もの。choices・正答①・difficulty・ID・question は現行維持。

```json
{
  "id": "kk11",
  "explanation": "正解は「ごか」。茨城県で唯一、利根川の南側にある町として知られています。"
}
```

年を直して残す案（`1981年に新利根川橋が開通するまで…`）は、「それまで直接結ぶ道路がなかった」の一次資料が取れていないため、今回は案にしない。

### kk07 邑楽: 「奈良時代の木簡」が資料の年代と合わない

現行の解説は `正解は「おうら」。奈良時代の木簡には古い読み「おおあらき」が記され、切り開いた土地を意味するという説があります。`

奈良文化財研究所の木簡庫では、該当の木簡は **藤原宮跡北面中門地区の出土で、遺構の年代観は694〜710年**。本文は「大荒城評胡麻□」という漢字表記で、説明欄は「上野国邑楽郡かあるいは飛騨国荒城郡か」と比定を保留している。[木簡庫](https://mokkanko.nabunken.go.jp/ja/6AJEKN340139)（主担当が取得し直して確認）

- 時代: 藤原京の時代（694〜710年）は平城遷都より前で、「奈良時代」とは合わない。
- 「読みが記され」: 書かれているのは漢字で、かなの読みではない。
- 比定: 木簡庫は邑楽郡と確定させていない。『日本歴史地名大系』「邑楽郡」は、藤原京出土の木簡の「大荒木評」を邑楽郡の古名としている（下請け調査がコトバンク経由で取得）。
- 「切り開いた土地」: 館林市第一資料館が、古くは「オオアラキ」と呼ばれ、「新たに開墾する」ことを強調した呼び名だったと説明している。[館林市第一資料館・館林の歴史概要](https://www.city.tatebayashi.gunma.jp/sp004/091/091/20250702185205.html)（主担当が取得し直して確認）。発信元は1件。

未承認の最小案は、**木簡と時代の話を外し、古い呼び名と意味だけを残す**もの。choices・正答①・difficulty・ID・question は現行維持。

```json
{
  "id": "kk07",
  "explanation": "正解は「おうら」。古くは「おおあらき」と呼ばれ、新しく切り開いた土地を意味するという説があります。"
}
```

設問の「群馬県東部」は、邑楽町公式が「群馬県の東南部」と書いている。食い違いとまでは言えず、精度メモにとどめる。

## 精度メモ（誤りとは扱わない。判断待ちへは起票しない）

P-2 の決着（「誤りではなく表現の精密さ」は報告書に記載するのみ）に従う。

| ID | 現行の表現 | 取得資料とのずれ |
|---|---|---|
| kk15 北杜 | 2003年に住民の公募で名づけられた | 公募（2003年4月）で集まった名前の中から、小委員会の絞り込みと住民意向調査を経て2003年8月に決定。公募の1位は別の名前だった。応募資格は住民以外にも開かれていた。市の誕生は2004年11月。 |
| kk13 真岡 | 「まおか」と読み間違えられがち／「舞丘」から転じた | 市公式によると「まおか」は明治期に実際に使われた読み。鶴の話の筋は「今日も舞うか」という言葉で、「舞丘から転じた」は資料より踏み込んでいる。 |
| kk18 小谷 | 山と谷にかこまれた地形を表す古い言葉 | 辞典の地形説は「断崖状になった谷の深い地形」。村公式が紹介するのは別の説（麻の産地から「麻垂」）。 |
| kk20 青海 | 豪族「青海首（おうみのおびと）」の名にちなむ | 確認できたのは「青海首の一族が青海神社を祀ったとされる」まで。地名がそれにちなむと書いた一次資料と、ふりがな「おうみのおびと」は未取得。 |
| kk10 木下 | 木材を「おろす」河岸として栄えた | 市の説明では、名前の由来（木を下ろした）と河岸の繁栄（旅客の河岸として）は別々に書かれている。 |
| kk12 十王 | 「十王堂」があったことに由来 | 裏づけは新聞記事1件のみ。記事の筋は「十王堂 → 十王川 → 村名・町名 → 駅名」で、駅名が堂から直接付いたわけではない。 |
| kk06 茂木 | 「もとき」（目立つ大木）が変化した | 一次資料では見つからない。出典のない名字サイトにのみ同じ趣旨の説明がある。 |
| kk16 鰍沢 | 魚のカジカや、似た姿のカエル「河鹿」 | カジカ・河鹿説は一次資料で未取得。辞典は河鹿をカジカガエルの別名とし、鳴き声が鹿に似ることからと説明する（魚と姿が似るとは書いていない）。 |

## 20問の取得範囲と残る確認

リンクは、特記したものを除き下請け調査が本文を取得した資料。自治体による伝承の紹介は「その説が紹介されている」範囲の支持。

| ID・現行の正答 | 設問・解説に対する支持範囲と資料 | 残る確認・判定の限界 |
|---|---|---|
| kk01 日暮里・②にっぽり | [JR東日本・時刻表](https://timetables.jreast.co.jp/timetable/list1184.html)に読みと山手線。[荒川区・歴史探訪](https://www.city.arakawa.tokyo.jp/unet/sightseeing/history/history/yurai.html)と[荒川区立図書館](https://www.library.city.arakawa.tokyo.jp/contents?pid=769)に「日ぐらしの里」の説。[京成電鉄](https://www.keisei.co.jp/keisei/tetudou/accessj/nippori.php)に荒川区の所在地。 | 資料の言い方は「日が暮れるまでいても飽きない」。先に「新堀（にっぽり）」の地名があり、後から字を当てたという順序で説明されている。JR の駅情報ページは未取得。 |
| kk02 生麦・③なまむぎ | [京急電鉄・生麦駅](https://www.keikyu.co.jp/ride/kakueki/KK31.html)に読み・鶴見区の所在地・本線。[横浜市鶴見区・鶴見の歴史](https://www.city.yokohama.lg.jp/tsurumi/shokai/gaiyo/sasshi/rekishi.html)に将軍の通行と生麦を敷いた説。 | 由来の説は横浜市の1発信元。京急は別の説（麦畑）を載せる。『新編武蔵風土記稿』の原文は未取得。 |
| kk15 北杜・①ほくと | [北杜市・沿革](https://www.city.hokuto.yamanashi.jp/docs/1498.html)に2004年11月の合併と名称の意味。[総務省 合併デジタルアーカイブ・選定経過](https://www.gappei-archive.soumu.go.jp/db/19yama/59-hokuto/gappei-kyohoku/oubo3.htm)に2003年8月の決定。 | 上の精度メモ。協議会の会議録は未取得。 |
| kk03 石神井・①しゃくじい | [練馬わがまち資料館](https://www.nerima-archives.jp/column/1178/)に読みと石棒・石神様の説。[板橋区公文書館](https://www.city.itabashi.tokyo.jp/kusei/shiryo/koubunsho/ichiran/1009264.html)に『四神地名録』の紹介。[東京都公園協会](https://www.tokyo-park.or.jp/park/format/index006.html)に公園の所在地。 | 2発信元で同じ趣旨の説を確認。いまの町名は石神井町・石神井台などで、設問の「石神井」は地域の名前として読める。 |
| kk04 蕨・①わらび | [JR東日本・時刻表](https://timetables.jreast.co.jp/timetable/list1704.html)に読みと京浜東北線。[蕨市・蕨の歴史](https://www.city.warabi.saitama.jp/shisei/youkoso/aramashi/1002240.html)に「蕨」説と「藁火」説。 | 由来は蕨市の1発信元。「山菜の」は解説側の言い換え。駅の住所は未取得。 |
| kk05 御宿・②おんじゅく | [御宿町・町名の由来](https://www.town.onjuku.chiba.jp/soumuka/town/townname.html)に読み・夷隅郡・北条時頼と最明寺の伝承。[千葉県 夷隅地域振興事務所](https://www.pref.chiba.lg.jp/kc-isumi/isumi/meisho.html)に最明寺の伝承。 | 県の資料は地名の由来には触れていない。『高林山々記』の原典は未取得。 |
| kk06 茂木・③もてぎ | [栃木県・市町一覧](https://www.pref.tochigi.lg.jp/c05/intro/tochigi/link/lkshityouson.html)に読みと芳賀郡。[長崎市・茂木の紹介](https://www.city.nagasaki.lg.jp/kanko/820000/827000/p023372.html)に「もぎ」。 | 上の精度メモ。『茂木町史』『ふるさと茂木の地名散歩』『角川日本地名大辞典 栃木県』は未取得。 |
| kk07 邑楽・①おうら | [邑楽町・町の概要](https://www.town.ora.gunma.jp/s002/050/050/020/gaiyo.html)と[群馬県・市町村名変遷早見表](https://www.pref.gunma.jp/page/14541.html)に読みと郡。[木簡庫](https://mokkanko.nabunken.go.jp/ja/6AJEKN340139)、[館林市第一資料館](https://www.city.tatebayashi.gunma.jp/sp004/091/091/20250702185205.html)。 | 上の確定事項。奈良時代の別の木簡に同じ表記があるかは未確認。『館林市史』は未取得。 |
| kk16 鰍沢・①かじかざわ | [富士川町・過疎地域持続的発展計画](https://www.town.fujikawa.yamanashi.jp/docs/2023082500242/file_contents/kasokeikaku2022.pdf)に2010年の合併。[富士川町・富士川舟運](https://www.town.fujikawa.yamanashi.jp/docs/2023090600071/)と[山梨県埋蔵文化財センター](https://www.pref.yamanashi.jp/maizou-bnk/topics/101-200/0188.html)に舟運での発展。 | 上の精度メモ。自治体としての鰍沢町は2010年に合併でなくなっており、「町です」は「まち」の意味で読む。『鰍沢町誌』は未取得。 |
| kk17 松代・①まつだい | [十日町市・町字名一覧](https://www.city.tokamachi.lg.jp/material/files/group/4/04_machiaza_matsudai.pdf)と[北越急行・駅舎紹介](https://www.hokuhoku.co.jp/ekisya.html)に読みと所在地。[長野市・住所から地区を調べる](https://www.city.nagano.nagano.jp/n022000/contents/p006281.html)と[文化庁・国指定文化財等データベース](https://kunishitei.bunka.go.jp/heritage/detail/401/1199)に「まつしろ」。 | 読み・所在とも独立した公的資料2件ずつで確認。残る確認なし。 |
| kk08 追浜・②おっぱま | [京急電鉄・追浜駅](https://www.keikyu.co.jp/ride/kakueki/KK54.html)に読み・所在地・「おいはま」という浜の説明。[神奈川県警察 田浦警察署](https://www.police.pref.kanagawa.jp/ps/taura/koban_guide.html)に「おいはま」から「おっぱま」になった説。 | 2発信元で確認。横須賀市の歴史年表 PDF は本文を抽出できず未取得。 |
| kk09 埼玉・③さきたま | [埼玉県・地勢と郷土の移り変わり](https://www.pref.saitama.lg.jp/a0314/saitama-profile/donna.html)と[行田市・観光スポット](https://www.city.gyoda.lg.jp/soshiki/kankyokeizaibu/shoko_kanko/gyomu/kanko_joho/8907.html)に読みと県名発祥の地。[行田市・住所表記早見表](https://www.city.gyoda.lg.jp/material/files/group/12/jyuusyohyoukihayamihyo.pdf)に「大字埼玉」。 | 県名発祥の碑は埼玉県側（県立さきたま史跡の博物館）の資料のみ。古墳群の正式表記は「埼玉古墳群」。 |
| kk10 木下・②きおろし | [JR東日本・時刻表](https://timetables.jreast.co.jp/timetable/list0542.html)に読みと成田線。[印西市・木下河岸と木下街道](https://www.city.inzai.lg.jp/0000022012.html)に木を下ろした由来。 | 上の精度メモ。由来は印西市の1発信元。 |
| kk11 五霞・①ごか | [五霞町・町の概要](https://www.town.goka.lg.jp/kurashi-machi-shigoto/gyousei/gyousei-notice/town-information/page000085.html)に読み。[五霞町・年表](https://www.town.goka.lg.jp/kurashi-machi-shigoto/gokanabi/youkoso/town-profile/town-history/page000012.html)に猿島郡・1996年の町制・1981年の新利根川橋。 | 上の確定事項。 |
| kk12 十王・③じゅうおう | [JR東日本・時刻表](https://timetables.jreast.co.jp/timetable/list0530.html)に読みと常磐線。[日立市 FAQ](https://www.city.hitachi.lg.jp/faq/shiseijoho/1006887/1007309.html)に2004年の編入。 | 上の精度メモ。駅名が2004年に「川尻」から改称された履歴は一次資料で未取得（現在の駅名は十王で、設問に影響なし）。 |
| kk13 真岡・③もおか | [真岡市・地名の由来](https://www.city.moka.lg.jp/kakuka/hishokoho/gyomu/gaiyo/shokai/1833.html)に読みの統一見解・鶴の話・諸説。[栃木県・市町村の変遷](https://www.pref.tochigi.lg.jp/a02/pref/shichouson/sonota/1176808058810.html)。 | 上の精度メモ。『真岡市史』原本は未取得。 |
| kk14 六合・①くに | [中之条町・道の駅六合](https://www.town.nakanojo.gunma.jp/soshiki/12/1360.html)と[群馬県・市町村名変遷早見表](https://www.pref.gunma.jp/page/14541.html)に読みと2010年の編入。[六合村の概要（国土交通省サイト掲載）](https://www.mlit.go.jp/common/000055845.pdf)に古事記・日本書紀にちなむ説明。 | 解説は「6つの大字が合わさった」点に触れていないが、誤りではない。現在の住所表記に「六合」は出ず、支所名などに残る。 |
| kk18 小谷・①おたり | [長野県・市町村一覧](https://www.pref.nagano.lg.jp/shichoson/kensei/shichoson/gappei/gappei/mejiiko/ichiran/index.html)と[小谷村・小谷村について](https://www.vill.otari.nagano.jp/soshiki/somu-shomu/gyomu/4/1/53.html)に読み・北安曇郡・語源は不明。 | 上の精度メモ。地形説は辞典1件（[日本歴史地名大系・コトバンク経由](https://kotobank.jp/word/%E5%B0%8F%E8%B0%B7-699435)）。 |
| kk19 小県・①ちいさがたぐん | [長野県・青木村案内 PDF](https://www.pref.nagano.lg.jp/ringyo/sangyo/ringyo/seibi/satooya/documents/06aoki.pdf)に読み。[日本歴史地名大系・コトバンク経由](https://kotobank.jp/word/%E5%B0%8F%E7%9C%8C%E9%83%A1)に2つの由来説。 | 由来は同辞典の1件のみ。郡は現存（長和町・青木村）。 |
| kk20 青海・①おうみ | [糸魚川市・沿革](https://www.city.itoigawa.lg.jp/page/2451.html)に2005年の合併。[えちごトキめき鉄道](https://www.echigo-tokimeki.co.jp/guide/hisui-line/)に青海駅の所在地。[糸魚川ジオパーク](https://geo-itoigawa.com/igp/24area/area03/)に読み。 | 上の精度メモ。『青海ふるさと事典』は未取得。 |

## 次の対象

ローテーションの次は `nandoku-kansai`（関西編）20問。
