// サークルタイム「自由タイムのニュース」に添える写真の候補を、Wikimedia Commons から探す（読むだけ）
// 使い方: node scripts/circle-time/commons-image.mjs "giant panda cub" [件数]
// 出すもの: 自由に使えるライセンス（CC0・パブリックドメイン・CC BY・CC BY-SA）の写真だけ。
// news.json の img にそのまま入れられる形（src・credit・license）と、確かめ用の page を出す。
// 写真は「話題のもの」のイメージ。出来事そのものの写真とは限らないので、画面には「写真（イメージ）」と出る
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = { 'User-Agent': 'roomk-tools-circle-daily/0.1 (circle time news image search)' };
export const FREE_LICENSE = /^(CC0|Public domain|PD\b|CC BY(-SA)? \d(\.\d)?)/i;
export const plain = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

export async function imageInfo(params) {
  const q = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '960', ...params });
  const res = await fetch(`${API}?${q}`, { headers: UA });
  if (!res.ok) throw new Error('commons ' + res.status);
  return ((await res.json()).query?.pages || []).filter((p) => p.imageinfo?.[0]);
}
export function toImg(p) {
  const ii = p.imageinfo[0], m = ii.extmetadata || {};
  const license = plain(m.LicenseShortName?.value);
  const artist = plain(m.Artist?.value);
  const credit = !artist ? '作者不明' : [...artist].length > 40 ? [...artist].slice(0, 37).join('').replace(/[\s,、]+(and|&)?\s*$/, '') + ' ほか' : artist;
  const src = String(ii.thumburl || ii.url).split('?')[0].replace('https://thumb.wikimedia.org/', 'https://upload.wikimedia.org/');
  return { src, credit, license, page: ii.descriptionurl, title: p.title, size: `${ii.width}x${ii.height}`, mime: ii.mime, free: FREE_LICENSE.test(license) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const words = process.argv[2];
  const limit = Number(process.argv[3] || 8);
  if (!words) { console.log('使い方: node scripts/circle-time/commons-image.mjs "検索語（英語がよく当たる）" [件数]'); process.exit(1); }
  const pages = await imageInfo({ generator: 'search', gsrnamespace: '6', gsrsearch: `${words} filetype:bitmap`, gsrlimit: String(limit * 3) });
  const list = pages.map(toImg).filter((x) => x.free && /^image\/(jpeg|png|webp)$/.test(x.mime)).slice(0, limit);
  if (!list.length) console.log('自由に使える写真が見つかりませんでした。検索語を変えるか、写真なしにする');
  for (const x of list) console.log(JSON.stringify({ img: { src: x.src, credit: x.credit, license: x.license }, page: x.page, size: x.size }));
}
