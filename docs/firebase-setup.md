# Firebase セットアップ手順

## 1. Firebaseプロジェクトの作成

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. 「プロジェクトを追加」をクリック
3. プロジェクト名を入力（例: `roomk-tools`）
4. Google アナリティクスは任意（不要なら無効化でOK）
5. 「プロジェクトを作成」をクリック

## 2. Webアプリの登録

1. プロジェクトのトップページで `</>` アイコン（Webアプリ追加）をクリック
2. アプリのニックネームを入力（例: `roomk-web`）
3. Firebase Hosting は **不要**（GitHub Pages を使うため）
4. 「アプリを登録」をクリック
5. 表示された `firebaseConfig` オブジェクトをコピーする

## 3. 設定の貼り付け

`shared/js/firebase-config.js` を開き、`firebaseConfig` の各値を差し替える：

```js
const firebaseConfig = {
  apiKey: "AIza...",          // ← コピーした値
  authDomain: "roomk-tools.firebaseapp.com",
  projectId: "roomk-tools",
  storageBucket: "roomk-tools.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123...",
};
```

## 4. Firestoreの有効化

1. Firebase Console 左メニュー「構築 > Firestore Database」
2. 「データベースを作成」をクリック
3. 「本番環境モード」を選択（後でルールを設定する）
4. リージョンは `asia-northeast1`（東京）を選択

## 5. Firebase Authentication の有効化

1. Firebase Console 左メニュー「構築 > Authentication」
2. 「始める」をクリック
3. 「ログイン方法」タブ → 「匿名」を有効化

## 6. Firestoreセキュリティルール

チェックイン・投票集計の削除に伴い、両アプリ向けの旧ルール設定例は削除しました。

Firestoreを使用するアプリを追加する場合は、[Firebase共通仕様](./development/firebase.md)を確認し、必要なルールをオーナーに相談してください。`firestore.rules` の変更・反映はオーナーの個別判断が必要です。

## 7. GitHub Pages での動作確認

GitHub Pages はHTTPS配信のため、Firebase の `authDomain` と一致していれば追加設定は不要。
リポジトリの Settings > Pages で `apps/` フォルダをルートに設定すること。
