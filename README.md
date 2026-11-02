# Wayback Auto Archiver

PCのChromeでアクセスしたページを、自動で全部 Wayback Machine に保存する Chrome 拡張（Manifest V3）です。

## 仕組み

- ページ表示完了（SPA の画面遷移含む）を検知して URL をキューに入れる
- キューを **8秒に1件** のペースで `https://web.archive.org/save/<URL>` へ送る
  （Wayback の上限は約15件/分。その半分以下に抑えています。429 が返ったら5分バックオフ）
- 同じ URL は **24時間は再保存しない**（設定で変更可）
- キューと履歴は `chrome.storage.local` に保存されるので、ブラウザ再起動後も続きから処理します

## インストール（Mac・CLIから）

```bash
curl -fsSL https://raw.githubusercontent.com/kandotrun/auto-wayback-machine/main/install.sh | bash
```

これで `~/auto-wayback-machine` へ取得（2回目以降は更新）、アイコン生成、パスのクリップボードコピー、Chromeの拡張機能ページを開くところまで自動でやります。

最後の読み込みだけは自動化できません。Chrome 137以降、通常版Chromeでは `--load-extension` フラグが無効化され、未パッケージ拡張は拡張機能ページからしか読み込めないためです。初回だけ:

1. 右上の「デベロッパーモード」を ON
2. 「パッケージ化されていない拡張機能を読み込む」
3. パスを貼り付け（Cmd+V）して `~/auto-wayback-machine` を選択

更新時は同じコマンドを再実行 → 拡張機能ページで ↻ を押すだけです。

手動で入れる場合は、このフォルダで `python3 scripts/generate_icons.py` を実行してアイコンを生成してから、同じ手順でフォルダを選んでください。

Mac の常用は Safari ですが、この拡張は Chrome 専用です。Chrome で開いたページだけが対象です。

## 安全側の初期設定（大事）

「全部」と言っても、以下は初期状態で送りません。設定画面で変更できます。

- ローカル / プライベートIP（localhost, 192.168.*, 10.* など）
- URL に認証情報が埋め込まれたもの
- クエリに `token` `session` `password` `code` `auth` などが含まれる URL
  （OAuthコールバックやワンタイムリンクの URL 自体が外に出るのを防ぐため）
- 除外ホストの初期値: `web.archive.org` / `archive.org` / `accounts.google.com` / `mail.google.com` / `localhost` / `127.0.0.1`

ネットバンキングなど「URL自体を知られたくない」サイトは、設定画面の除外ホストに追加してください（サブドメイン込みで効きます）。

## 限界（仕様です）

- Wayback のクローラは **あなたのログイン状態を持ちません**。ログインが必要なページは、あなたが見ている画面ではなく公開側／ログイン画面が保存されます。「見た画面そのもの」の記録にはなりません。
- JavaScript で描画するページ（SPA）は保存が不完全になることがあります。
- Wayback 側で robots.txt 等により保存を拒否されるサイトがあります。
- 一度 Wayback に保存されたものは、原則として取り消せません。

## ファイル構成

- `manifest.json` — MV3 マニフェスト
- `background.js` — 検知・キュー・送信（サービスワーカー）
- `popup.html/js/css` — 状況表示、ON/OFF、今すぐ保存
- `options.html/js` — 除外リスト、間隔、重複期間の設定
- `install.sh` — Mac用インストーラ／アップデータ
- `scripts/generate_icons.py` — アイコンPNGの生成（標準ライブラリのみ、gitにPNGを入れないため生成式）
