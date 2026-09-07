# C-1 調査報告: 難読地名・駅名クイズ 第2回・北海道東北（2026-09-08）

## 範囲と到達点

- 対象は `nandoku-north` の nn01〜nn20、20問。読み・自治体/駅の帰属・解説の主張を棚卸しし、自治体・鉄道事業者等の公開本文を優先して一巡した。調査と未承認案の記録のみで、問題データは変更していない。
- 調査開始 HEAD: `dfd65d07082a337e4d4cfa14d4ac1ca54176570e`。
- `apps/quiz/questions.js` SHA-256: `65205894c67f6fea1a2a76c908bc78344ce944194fcfe257a56630ed8dc3ff15`。終了前にも一致を確認。
- [第1回](c1-nandoku-verification-batch1.md)を引き継ぐ。ただし今回は**20問の全主張について独立した一次資料2件を満たした完了報告ではない**。各問の取得本文・支持範囲・未取得を下記に残す。同一自治体の別ページや紹介記事を、由来の独立した二重立証とは数えない。
- 読みの正答を覆す資料は今回見つからなかった。確定した設問上の取り違えは **nn06 のJR駅名1件**。nn02 は由来の対象差の要注意メモ。他の未取得・表現精度メモを誤りや新規修正必須件数に算入しない。
- 参照日は2026-09-08。現行の自治体・事業者ページを照合したが、全自治体の合併史・全駅の改廃履歴を網羅した保証ではない。歴史資料は当時の説明の根拠として使用した。

## 人間判断へ渡す確定事項: nn06

現行設問は `青森県の町名・JR駅名「大鰐」は、何と読む？`。JR東日本の駅案内は **大鰐温泉（おおわにおんせん）**、弘南鉄道の駅案内は **大鰐（おおわに）** で、同ページもJR奥羽本線の大鰐温泉駅への乗り換えと区別している。このため「大鰐」を現行JR駅名とする部分は取り違えと判断する。[JR東日本・大鰐温泉駅](https://www.jreast.co.jp/estation/stations/353.html)、[弘南鉄道・大鰐駅](https://konantetsudo.jp/station/station-owani/station-owani14/)

未承認の最小案は **question の「・JR駅名」だけを削除**し、町名の読みを問う形に限定する。弘南鉄道への置換案ではないため、鉄道の運行予定・休止予定を設問に持ち込まない。

```json
{
  "id": "nn06",
  "difficulty": 2,
  "question": "青森県の町名「大鰐」は、何と読む？",
  "choices": ["たいがく", "おおわに", "おおがく"],
  "answerIndex": 1,
  "explanation": "正解は「おおわに」。古い言葉で「鰐」が大きな魚を指したという説や、大きな仏像にちなむという説などがあります。"
}
```

choices・正答②・difficulty・explanation・IDは現行維持。解説の大きな魚/仏像の2説は今回一次本文を取得できず、維持案はその真偽を新たに保証するものではない。承認前の実装・コミット・公開はしない。

## 要注意メモ: nn02（確定誤りの別件として起票しない）

現行解説は「岩木川の流れの変化で、五つの村や場所ができたから」という説。五所川原市立図書館が公開する『五所川原の地名をたずねて』の該当項目（冊子43〜45頁、特に44頁）は『平山日記』の記述を掲げ、岩木川の曲流に伴う**五カ所の川原**を説明する。「村」とは対象が違い、「場所」では川原の意味が落ちる。[市立図書館・本文PDF](https://www.city.goshogawara.lg.jp/lib/document/files/chimei43-106.pdf)、[市立図書館・刊行案内](https://www.city.goshogawara.lg.jp/lib/document/chimei.html)

PDF44頁は本文抽出に加えて画像で確認した。ただし刊行案内は同じ資料の案内であって独立支持ではなく、別の「五つの村」伝承が存在しないことまで確認したわけではない。したがって「現行由来説は必ず誤り」とは断定しない。未承認の精度改善メモとしては `正解は「ごしょがわら」。岩木川が曲がって流れ、五カ所に川原ができたことに由来する、という説があります。` が取得資料の対象に近い。設問・選択肢・正答①はこのメモの対象外。

## 20問の取得範囲と残る確認

以下のリンクは、特記した取得制限を除き公開本文を取得した資料。自治体による伝承紹介は「その説が自治体に紹介されている」範囲の支持であり、歴史的発生を実証したこととは区別する。観光協会の自地域紹介も発信主体を明記し、学術的な独立一次資料とは扱わない。

| ID・現行の正答 | 設問/解説に対する支持範囲と資料 | 残る確認・判定の限界 |
|---|---|---|
| nn01 長万部・②おしゃまんべ | [長万部町・アイヌ施策事業計画PDF](https://www.town.oshamambe.lg.jp/uploaded/life/4574_9433_misc.pdf) 2頁に横向きの川口/カレイの伝承。[鉄道・運輸機構の現場取材](https://www.jrtt.go.jp/project/working-report/hokkaido/no67/)に読み。[JR北海道・おもな駅](https://www.jrhokkaido.co.jp/network/tel/eki.html)に長万部駅掲載（2026-09-01現在表記）。 | 町PDF2頁は画像でも確認。由来の独立2件目は未充足。取材記事は2020年の記事で、現在の運行計画の証拠には用いない。 |
| nn02 五所川原・①ごしょがわら | [JR東日本・駅情報](https://www.jreast.co.jp/estation/station/info.aspx?StationCd=689)が読み/市内住所。[市立図書館PDF](https://www.city.goshogawara.lg.jp/lib/document/files/chimei43-106.pdf)が川原由来説。 | 上記要注意メモ。図書館の同一刊行物を複数の独立由来資料とは数えない。 |
| nn03 倶知安・②くっちゃん | [倶知安町・概要](https://www.town.kutchan.hokkaido.jp/profile/gaiyou/)がクッチャン、kut-san-i と流れ出る場所の説明。[北海道開発局・倶知安町](https://www.hkd.mlit.go.jp/ot/tiiki_sinkou/ad7hk900000000zg.html)が町とスキーの地域紹介。[鉄道・運輸機構](https://www.jrtt.go.jp/project/working-report/hokkaido/no67/)にも読み。 | 現行「管のように深く刻まれた川」の全文を町の語釈がそのまま支えるわけではない。「深く刻まれた」の直接支持と独立由来2件目は未充足。異説を否定せず表現精度メモに留める。 |
| nn04 興部・③おこっぺ | [興部町・プロフィール](https://www.town.okoppe.lg.jp/gaiyo/gaiyo_0profile.htm)にオホーツク側の位置と川尻合流の由来。[興部町の現行サイト](https://www.town.okoppe.lg.jp/cms/)も町の現存を支持。 | 同一自治体のページ。由来の独立2件目は未取得。旧プロフィールは一部文字化けがあるが当該説明は読めた。 |
| nn05 神居古潭・②かむいこたん | [旭川市・神居古潭](https://www.city.asahikawa.hokkaido.jp/kurashi/329/348/354/p000144.html)が読み、神の集落、石狩川の難所。[林野庁・嵐山神居自然休養林](https://www.rinya.maff.go.jp/hokkaido/policy/system/rekumori/sizen_kyuuyourin/arasiyama_kamui/index.html)が旭川の景勝地としての位置づけ。 | 林野庁資料は語源を重ねて立証する資料ではない。意味の趣旨は市資料と整合、由来の独立2件目は未取得。 |
| nn06 大鰐・②おおわに | [JR東日本](https://www.jreast.co.jp/estation/stations/353.html)と[弘南鉄道](https://konantetsudo.jp/station/station-owani/station-owani14/)の正式駅名・読みを対照。弘南の駅住所は大鰐町。 | JR駅名の取り違え確定。町名に限定する未承認案は上記。大魚/仏像の由来説は本文未取得。 |
| nn07 弟子屈・③てしかが | [弟子屈町・町名の由来](https://www.town.teshikaga.hokkaido.jp/kurashi/soshikiichiran/somuka/8/1/811.html)が岩盤の上の説。[同町・2026年の川湯温泉発信](https://www.town.teshikaga.hokkaido.jp/kurashi/soshikiichiran/kankoshokoka/2/5925.html)が現在の北海道の町としての所在地/名称を支持。 | 2件目は町の現行性だけを補う。同町教育資料の検索結果にも由来があるが、独立支持には数えず、由来2件目未充足。 |
| nn08 音威子府・①おといねっぷ | [音威子府村・概要](https://www.vill.otoineppu.hokkaido.jp/about/gaiyou.html)が泥で濁る川口等の複数説と1963年の常盤村からの改称。[JR北海道・沿線紹介](https://www.jrhokkaido.co.jp/soyasen/otoineppu.html)が村と「おといねっぷ」の表記。[JRの駅一覧](https://www.jrhokkaido.co.jp/network/tel/eki.html)に音威子府。 | 由来の独立2件目は未取得。JRの動的運行ページは本文取得で駅欄が空だったため、検索結果だけを現在時刻表の根拠にしない。 |
| nn09 妹背牛・③もせうし | [北海道開発局・妹背牛町](https://www.hkd.mlit.go.jp/sp/tiiki_sinkou/kluhh40000002wup.html)がイラクサ由来、駅開設時の漢字表記、町制の説明。[妹背牛町・現行サイト](https://www.town.moseushi.hokkaido.jp/index.html)が町/「もせうし」の表記。 | 由来の独立2件目とJR事業者の現行駅本文は未取得。町立小学校のJR駅アクセス紹介は検索結果取得のみ、本文タイムアウトにつき確定支持に数えない。 |
| nn10 撫牛子・②ないじょうし | [JR東日本・駅情報](https://www.jreast.co.jp/estation/station/info.aspx?StationCd=1080)が読みと弘前市内住所。[JR時刻表](https://timetables.jreast.co.jp/timetable/list1080.html)が奥羽本線。 | 同一事業者の2ページ。読み/路線は整合するが「古い地名」「由来には諸説」の由来資料は未取得。 |
| nn11 男鹿・②おが | [男鹿市・子ども向け市紹介](https://www.city.oga.akita.jp/soshik/kikakuseisakuka/kidspage/1023.html)に読み/秋田県/半島。[秋田県・男鹿市女川地域紹介](https://common3.pref.akita.lg.jp/genkimura/genre/akita/onnagawa)に男鹿半島となまはげ。 | 「おじかと読み間違えられがち」の一般的傾向は未裏付け。正答が違うという意味ではなく、誤読頻度を推定しない。 |
| nn12 秋保・③あきう | [東北歴史博物館・秋保の田植踊](https://www.thm.pref.miyagi.jp/ich/mukei/125/)に読みと仙台市太白区秋保町湯元。[仙台市FAQ・秋保温泉郷](https://guide.callcenter.city.sendai.jp/hc/ja/articles/5114958922526-%E7%A7%8B%E4%BF%9D%E6%B8%A9%E6%B3%89%E9%83%B7%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6%E6%95%99%E3%81%88%E3%81%A6%E3%81%8F%E3%81%A0%E3%81%95%E3%81%84-%E3%81%BE%E3%81%9F-%E8%A1%8C%E3%81%8D%E6%96%B9%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6%E6%95%99%E3%81%88%E3%81%A6%E3%81%8F%E3%81%A0%E3%81%95%E3%81%84)に奥座敷の呼称/仙台駅から車で40〜50分程度の目安。 | 取得本文と現行の趣旨は整合。「近い」は相対表現で、現在の所要時間や交通状況の保証ではない。 |
| nn13 寒河江・②さがえ | [寒河江市・現行サイト](https://www.city.sagae.yamagata.jp/)に市報さがえ等の表記。[山形県・寒河江市](https://www.pref.yamagata.jp/110001/sangyo/sangyoushinkou/him_top/him_maincat3/him_12.html)にさくらんぼの里/市域に沿う最上川。 | 取得した地域説明と趣旨は整合。生産量の順位や市域全体が川沿いという断定はしていない。 |
| nn14 大迫・③おおはさま | [花巻市・大迫中学校の地域紹介](https://www.city.hanamaki.iwate.jp/kosodate_kyoiku/kyoiku/sho_chugakko/website/1001550/1012754/index.html)に読み、2006年の合併、ぶどう/ワイン。[花巻市・2017年会見](https://www.city.hanamaki.iwate.jp/shisei/shicho/kisyakaiken/1003132/1003136.html)に宿場町400年事業。 | 同一自治体の別資料。独立自治体としての旧大迫町と、現行設問の「花巻市の町名」を区別し、設問に取り違えは認めなかった。 |
| nn15 閖上・②ゆりあげ | [名取市公式note・学生記事](https://natori-city.note.jp/n/naece993e4961)に読み/港町と伊達綱村による文字の伝承。[名取市観光情報サイト・閖上](https://www.kankou.natori.miyagi.jp/exploreyuriage/)にも藩主の伝承。 | 両方とも伝承の紹介で、歴史的命名行為の独立実証ではない。漢字の選定と「ゆりあげ」という音自体の成立は別。現行も「伝わります」としており確定誤りにしない。 |
| nn16 生保内・③おぼない | [仙北市・生保内公園](https://www.city.semboku.akita.jp/sightseeing/spot/04_obonai.html)に読み/田沢湖生保内の所在地。[仙北市・地域運営体](https://www.city.semboku.akita.jp/citizens/tiikiuneitai.html)に旧町村単位の生保内地域。 | 同一自治体2資料。田沢湖地域という支持から湖への距離は推定せず、「そば」の距離感とアイヌ語由来説の一次本文は未確認。 |
| nn17 腹帯・③はらたい | [JR東日本・駅情報](https://www.jreast.co.jp/estation/station/info.aspx?StationCd=1257)に読み/宮古市住所。[JR時刻表](https://timetables.jreast.co.jp/timetable/list1257.html)に山田線。 | 同一事業者の別ページ。「初見で正しく読める人が少ない」「全国屈指」の一般頻度/全国比較は未裏付け。読み・駅の帰属とは分ける。 |
| nn18 温海・③あつみ | [鶴岡市・温海地域概要](https://www.city.tsuruoka.lg.jp/shisei/shiyakusyo/infomation/atsumi/gaiyo/chiikigaiyou-at.html)に旧町/現地域、あつみ温泉、湯が川経由で海を温めた由来。[鶴岡市観光連盟・温海エリア](https://www.tsuruokakanko.com/area/atsumi)にあつみ温泉。 | 2件目は温泉地の紹介で、由来の独立支持ではない。市本文の「川」を固有の「温海川」とする点の直接支持も追加確認余地。古い合併資料の検索結果は独立本文確認に数えない。 |
| nn19 檜枝岐・③ひのえまた | [檜枝岐村・村の概要](https://www.vill.hinoemata.lg.jp/sp/soumu/gaiyo/000014.html)に山地/豪雪。[檜枝岐村観光施設事業所](https://www.vill.hinoemata.lg.jp/kankounews/)に尾瀬の玄関口という紹介。[檜枝岐温泉観光協会](https://www.oze-info.jp/)の表題にひのえまた。 | 村と地域観光主体の説明は整合。観光施設の旧記事から現在の営業時間等は推定しない。県の市町村読み一覧は本文取得に失敗し支持件数に数えない。 |
| nn20 塙・③はなわ | [塙町・町の紹介](https://www.town.hanawa.fukushima.jp/page/dir000023.html)に広報はなわ/所在地東白川郡。[塙町・由来](https://www.town.hanawa.fukushima.jp/page/page000579.html)が漢字の意味と地名語を区別し、台地の端や高い土地の意味を説明。 | 同一自治体2ページ。町の説明は現行の「小高くなった場所」より細かいが、単なる精度改善を新たな誤りとしない。由来の独立2件目は未取得。 |

## 未完了の扱い・次の確認範囲

- 各問2件を探す過程で、駅情報と時刻表、自治体紹介と同じ自治体の広報、観光記事等が集まった。**2URLがあることと、読み・帰属・由来すべてが各々2件の独立一次資料で裏付いたことは違う**。この報告の一覧を「20問完全OK」に置き換えない。
- 継続する場合は、nn01〜nn09・nn15・nn18・nn20の由来の独立性、nn06/nn10/nn16の取得できていない由来本文、nn09のJR現行駅情報、nn11/nn17の傾向表現を主に確認する。これは誤り件数や修正必須件数ではない。
- 検索語は地名＋読み/由来/町の概要/駅情報を基本とし、自治体ドメイン、JR、弘南鉄道、国交省・林野庁等へ絞った。由来の個人サイトや検索抜粋だけで誤り確定・未解消の解消を判定していない。購入・問い合わせ・アクセス制限回避はしていない。
- 一部の動的ページは再取得で本文が得られたが、福島県の市町村一覧、妹背牛小学校アクセス等は未取得として残した。PDFはPDFスキルに従い対象資料を読み、長万部計画2頁と五所川原冊子44頁を一時画像で目視確認。取得失敗自体はコンテンツの誤りではない。
- P-2の精度向上メモ運用を維持し、明白なnn06以外を自動で新P票へ流さない。nn06の採番/人間承認は統合担当で判断する。本担当は新しい本報告書のみ作成し、README・バックログ・旧報告・アプリは編集していない。コミット/プッシュ/本番操作/実機・UI検証は未実施。

## 統合・独立レビュー追記

統合担当がnn06の最小修正案をP-15として起票し、回答欄は空欄とした。既存の保留7件は変更していない。

同系統の別コンテキストによる読み取り専用レビューで、20行のID・選択肢上の正答番号を現行データと照合し、nn06の提案JSONがquestionの「・JR駅名」削除だけであることを機械確認した。JR東日本・弘南鉄道の公式本文も再取得し、P-15との整合を確認した。追加修正要求なし。レビューは全20問の出典再取得やPDF再確認ではなく、記録の範囲整合とnn06の一次2ページに限定する。主担当もnn06の両公式本文と、問題ファイルのSHA-256不変を確認した。
