/**
 * 漢字さがし — 問題データ
 *
 * visualDifficulty: 1 = easy, 2 = moderate, 3 = hard
 */
export const QUESTIONS = [
  // --- visualDifficulty 1 ---
  { target: '犬', distractors: ['大', '太', '天'], visualDifficulty: 1 },
  { target: '土', distractors: ['士', '工', '十'], visualDifficulty: 1 },
  { target: '人', distractors: ['入', '八', '大'], visualDifficulty: 1 },
  { target: '木', distractors: ['本', '末', '未'], visualDifficulty: 1 },
  { target: '口', distractors: ['日', '目', '田'], visualDifficulty: 1 },
  { target: '力', distractors: ['刀', '九', '方'], visualDifficulty: 1 },
  { target: '山', distractors: ['出', '凸', '岳'], visualDifficulty: 1 },
  { target: '火', distractors: ['水', '氷', '永'], visualDifficulty: 1 },
  { target: '上', distractors: ['下', '止', '正'], visualDifficulty: 1 },
  { target: '王', distractors: ['玉', '主', '生'], visualDifficulty: 1 },
  { target: '右', distractors: ['左', '石', '有'], visualDifficulty: 1 },
  { target: '円', distractors: ['丹', '内', '月'], visualDifficulty: 1 },
  {
    target: '千',
    distractors: ['干', '午', '汗'],
    visualDifficulty: 1,
    // どこが違うか: 「千」は上の払いが「十」の縦画と交差する。「干」は払いがなく縦棒が上下に突き抜ける。「午」は下の横棒が短く、縦棒が下に突き抜けない。「汗」は氵（さんずい）がつく。
  },
  {
    target: '名',
    distractors: ['各', '合', '谷'],
    visualDifficulty: 1,
    // どこが違うか: 「名」の上部は「タ」（夕）。「各」は上部が「夂」で払いの向きが逆。「合」は上部が三角に閉じた形。「谷」は下部が「口」でなく八の字に開く。
  },
  {
    target: '有',
    distractors: ['在', '布', '存'],
    visualDifficulty: 1,
    // どこが違うか: 「有」は「ナ」＋「月」。「在」は「ナ」＋「土」（月か土かがポイント）。「布」は「ナ」＋「巾」。「存」は「ナ」＋「子」。
  },

  // --- visualDifficulty 2 ---
  { target: '日', distractors: ['目', '白', '田'], visualDifficulty: 2 },
  { target: '末', distractors: ['未', '本', '木'], visualDifficulty: 2 },
  { target: '刀', distractors: ['力', '万', '方'], visualDifficulty: 2 },
  { target: '由', distractors: ['甲', '申', '田'], visualDifficulty: 2 },
  { target: '矢', distractors: ['失', '央', '大'], visualDifficulty: 2 },
  { target: '午', distractors: ['牛', '干', '千'], visualDifficulty: 2 },
  { target: '休', distractors: ['体', '件', '仕'], visualDifficulty: 2 },
  { target: '待', distractors: ['持', '特', '時'], visualDifficulty: 2 },
  { target: '池', distractors: ['地', '他', '也'], visualDifficulty: 2 },
  { target: '冬', distractors: ['各', '久', '夕'], visualDifficulty: 2 },
  { target: '用', distractors: ['角', '同', '周'], visualDifficulty: 2 },
  { target: '手', distractors: ['毛', '千', '牛'], visualDifficulty: 2 },
  {
    target: '実',
    distractors: ['宝', '客', '宗'],
    visualDifficulty: 2,
    // どこが違うか: いずれもウ冠。「実」はウ冠の下が「一＋大」に近い形。「宝」は下に「王」。「客」は下に「各」。「宗」は下に「示」。
  },
  {
    target: '完',
    distractors: ['官', '宮', '宣'],
    visualDifficulty: 2,
    // どこが違うか: いずれもウ冠。「完」は下に「元」。「官」は下に口が重なる形。「宮」は口が縦に二つ並ぶ。「宣」は下に「亘」（日を挟む形）。
  },
  {
    target: '味',
    distractors: ['抹', '妹', '昧'],
    visualDifficulty: 2,
    // どこが違うか: 「未」を含む仲間。「味」は口へん＋未。「抹」は扌（てへん）＋末（横棒の長さが違う「未」に似た旁）。「妹」は女へん＋未。「昧」は日へん＋未。
  },
  {
    target: '復',
    distractors: ['複', '腹', '覆'],
    visualDifficulty: 2,
    // どこが違うか: 旁「复」が共通。「復」は彳（ぎょうにんべん）。「複」は衤（ころもへん）。「腹」は月（にくづき）。「覆」は上に「西」が乗る。
  },

  // --- visualDifficulty 3 ---
  { target: '己', distractors: ['已', '巳', '巴'], visualDifficulty: 3 },
  { target: '間', distractors: ['問', '聞', '閉'], visualDifficulty: 3 },
  { target: '鳥', distractors: ['烏', '島', '馬'], visualDifficulty: 3 },
  { target: '幸', distractors: ['辛', '辞', '幹'], visualDifficulty: 3 },
  { target: '貸', distractors: ['貨', '賃', '貧'], visualDifficulty: 3 },
  { target: '折', distractors: ['析', '所', '近'], visualDifficulty: 3 },
  { target: '博', distractors: ['薄', '専', '簿'], visualDifficulty: 3 },
  { target: '候', distractors: ['侯', '伏', '俊'], visualDifficulty: 3 },
  { target: '陸', distractors: ['睦', '隆', '隊'], visualDifficulty: 3 },
  { target: '衰', distractors: ['哀', '衷', '表'], visualDifficulty: 3 },
  { target: '令', distractors: ['今', '合', '会'], visualDifficulty: 3 },
  {
    target: '経',
    distractors: ['径', '軽', '茎'],
    visualDifficulty: 3,
    // どこが違うか（にている部首）: 旁「圣」が共通で偏だけが違う。「経」は糸へん。「径」は彳（ぎょうにんべん）。「軽」は車へん。「茎」は草冠。
  },
  {
    target: '織',
    distractors: ['職', '識', '繊'],
    visualDifficulty: 3,
    // どこが違うか（にている部首）: 「織」「職」「識」は「戠」を含む仲間で、糸へん／耳へん／言べんが違う。「繊」は旁が「戠」でなく「韱」だが、同じ糸へんで画数・字面の密度が近く紛らわしい。
  },
  {
    target: '陽',
    distractors: ['陰', '湯', '揚'],
    visualDifficulty: 3,
    // どこが違うか（にている部首）: 「陽」は阝（こざとへん）＋「昜」。「陰」は同じ阝だが旁が「侌」で別形。「湯」は氵（さんずい）＋「昜」。「揚」は扌（てへん）＋「昜」。
  },
  {
    target: '権',
    distractors: ['勧', '観', '歓'],
    visualDifficulty: 3,
    // どこが違うか（にている部首）: 旁「雚」が共通。「権」は木へん。「勧」は力。「観」は見。「歓」は欠。つくり側の部品で見分ける。
  },
  {
    target: '招',
    distractors: ['紹', '昭', '詔'],
    visualDifficulty: 3,
    // どこが違うか（にている部首）: 「召」を含む仲間。「招」は扌（てへん）。「紹」は糸へん。「昭」は日へん。「詔」は言べん。
  },
  {
    target: '判',
    distractors: ['版', '半', '伴'],
    visualDifficulty: 3,
    // どこが違うか（にている部首）: 「半」を軸にした仲間。「判」は刂（りっとう）＋半。「版」は片＋反（形が近い別部品）。「半」はそのままの単独字。「伴」はにんべん＋半。
  },
  {
    target: '額',
    distractors: ['顔', '願', '頑'],
    visualDifficulty: 3,
    // どこが違うか（にている部首）: 旁「頁」（おおがい）が共通。「額」は左に「客」。「顔」は左に「彦」。「願」は左に「原」。「頑」は左に「元」。
  },
  {
    target: '講',
    distractors: ['構', '溝', '購'],
    visualDifficulty: 3,
    // どこが違うか（にている部首）: 旁「冓」が共通。「講」は言べん。「構」は木へん。「溝」は氵（さんずい）。「購」は貝へん。
  },
];
