# UiPathFriends
UiPath Community of Japan Chapter 

## UiPath ブログ集

GitHub Pages 公開用の静的サイトを `docs/` 配下に配置しています。

- トップページ: `docs/index.html`
- 記事データ: `docs/articles.json`
- 自動更新スクリプト: `docs/scripts/update-articles.mjs`
- 自動更新ワークフロー: `.github/workflows/update-articles.yml`

## GitHub Pages の公開設定

1. GitHubで `Settings` を開く
2. 左メニューの `Pages` を開く
3. `Build and deployment` の `Source` を `Deploy from a branch` にする
4. `Branch` を `main`、フォルダを `/docs` にする
5. `Save` を押す

公開後のURLは通常、次の形式になります。

```text
https://shumpeiwatanabeuipath.github.io/UiPathFriends/
```

## 記事データの自動更新

GitHub Actions が毎日 03:00 JST に `docs/articles.json` を更新します。
手動で更新したい場合は、Actions の `Update blog articles` から `Run workflow` を実行してください。

### Qiita の取得条件

Qiita は次のいずれかに該当する記事だけを取得します。

- タイトルに `UiPath` が含まれる
- タグに `UiPath` が含まれる
