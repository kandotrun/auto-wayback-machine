# Wayback Auto Archiver

## 概要

PC の Chrome でアクセスしたページの URL を、Wayback Machine に自動送信する個人用 Chrome 拡張（Manifest V3）です。安全のための除外ルールがあり、すべてのページが保存されるわけではありません。Chrome で開いたページだけが対象です。

## CLI での入れ方

Mac で Git と Python 3 が必要です。Git がなければ `xcode-select --install` を実行してください。

```bash
curl -fsSL https://raw.githubusercontent.com/kandotrun/auto-wayback-machine/main/install.sh | bash
```

リポジトリを `~/auto-wayback-machine` に取得し、PNG アイコンを生成して、読み込むフォルダのパスをクリップボードへコピーし、Chrome の拡張機能ページを開きます。初回は次の操作をしてください。

1. `chrome://extensions/` で「デベロッパーモード」を ON にする。
2. 「パッケージ化されていない拡張機能を読み込む」を押す。
3. コピーしたパスを貼り付け、**`~/auto-wayback-machine/extension`** を選ぶ。

更新時は同じコマンドを再実行し、拡張機能ページで ↻ を押してください。`AUTO_WAYBACK_DIR` で取得先を指定できます。

手動で取得した場合は、リポジトリのルートで次を実行し、`extension/` を読み込みます。Node.js やビルドはインストールに不要です。

```bash
python3 scripts/generate_icons.py
```

旧版でリポジトリのルートを読み込んでいる場合は、更新後の読み込み先が `extension/` に変わります。切り替え前に旧版の設定・履歴を確認してください。Chrome が別の拡張として扱う場合、既存のローカルデータは自動移行されません。

## 仕組み

- メインフレームの表示完了と SPA の履歴変更を検知し、URL のフラグメントと追跡用クエリを除去して除外判定する。
- 同じ URL の保存済み記録（初期値 24 時間）とキュー内の重複を確認して、キューに追加する。
- 初期値 8 秒間隔で `https://web.archive.org/save/<URL>` に GET を送る。ログイン用 Cookie は送らない。
- Save Page Now のデフォルト動作で、ページ本体と表示に必要な埋め込みリソース（画像・CSS・JavaScript）を保存対象とする。
- `capture_outlinks`（リンク先ページの自動保存）、`capture_screenshot`（スクリーンショット保存）、`capture_all`（エラーページも保存）は指定しない。
- 429 / 503 では項目を残し、5 分後の再試行アラームを設定する。それ以外の送信失敗は 3 回で失敗として記録する。
- 設定・キュー・重複記録・履歴・統計は `chrome.storage.local` に保存する。起動時やアラームでキュー処理を再開する。
- 履歴は最大 200 件、重複記録は直近 30 日以内の最大 5,000 件を保持する。

ポップアップで自動保存の ON/OFF、統計、最近の送信履歴を確認できます。「このページを今すぐ保存」は重複期間を無視してキューに追加しますが、安全フィルタは適用します。自動保存が OFF の間はキュー処理も停止します。

## 設定

ポップアップの「設定（除外リストなど）」から変更します。

| 設定 | 初期値・意味 |
| --- | --- |
| 自動保存 | ON |
| 同じ URL を再保存しない期間 | 24 時間（0 で保存済み記録による重複排除を無効化） |
| 保存リクエストの最小間隔 | 8 秒（保存可能範囲 4〜120 秒） |
| トラッキングパラメータの除去 | ON。`utm_*`、`fbclid`、`gclid` などを除去 |
| センシティブなクエリの除外 | ON。`token`、`session`、`password`、`code` などのキーを除外 |
| 除外ホスト | `localhost`、`127.0.0.1`、`web.archive.org`、`archive.org`、`accounts.google.com`、`mail.google.com` |
| 除外パターン | 空。URL に含まれる文字列を大文字・小文字を区別して照合 |

除外ホストはサブドメインにも適用します。`example.com` と `*.example.com` はどちらも本体とサブドメインを除外します。「履歴と重複記録をクリア」はキューと統計もクリアします。

## プライバシーと安全上の注意

URL は外部サービスの Internet Archive に送られ、保存結果が公開される可能性があります。一度保存されたものは原則として取り消せません。銀行や Web メールなど、URL 自体を知られたくないサイトは除外ホストに追加してください。

ローカル／プライベートホスト（localhost、`.local`、127.*、10.*、192.168.*、172.16〜31.*）と IPv6 ホスト、認証情報入り URL は設定にかかわらず送りません。センシティブなクエリの除外は既知のキーに対する判定であり、すべての秘密情報を検出できるものではありません。URL のパスや独自のクエリに秘密が入るサイトは、ホストやパターンで除外してください。手動保存にも同じ安全判定を適用します。

## 制限

- Chrome 137 以降の通常版 Google Chrome では `--load-extension` が使えないため、拡張機能ページで手動読み込みが必要です。
- Wayback のクローラはあなたのログイン状態を持ちません。ログインが必要なページは、公開側やログイン画面が保存されるため、見た画面そのものの記録にはなりません。
- JavaScript で描画するページは保存が不完全になることがあります。サイトや Wayback 側の制限で保存できない場合もあります。
- 保存対象はページ本体と埋め込みリソースです。ページ内のリンク先をたどる自動保存、スクリーンショット保存、エラーページを含める保存は有効にしていません。
- 「送信済み」（`submitted`）は、送信リクエストの HTTP 応答が成功扱い（200〜399）だった件数です。`/save/status` のポーリングによる Wayback 側ジョブの完了確認は行っていません。保存の完了や、ページ本体・埋め込みリソースがすべて保存されたことを保証するものではありません。
- MV3 のサービスワーカーは Chrome に停止されるため、送信間隔や再試行時刻は厳密な実行保証ではありません。

## 開発とテスト

Node.js 22 以降と Python 3 を使います。依存パッケージの追加や `npm install`、ビルドは不要です。

```bash
python3 scripts/generate_icons.py
npm run check
npm test
python3 scripts/check_icons.py
```

`check` は JavaScript の `node --check`、シェル構文、バージョンの整合、manifest・HTML・ES module の参照先を確認します。アイコン生成を先に実行してください。`test` は Node 標準テストランナーで URL・除外・重複・履歴・サービスワーカーの挙動を検証します。GitHub Actions でも push / pull request 時に実行します。

Chrome での確認手順と、今回の整理で維持する仕様は [検証メモ](docs/verification.md) を参照してください。生成 PNG は Git に追加しません。

## ファイル構成

| 場所 | 役割 |
| --- | --- |
| `extension/manifest.json` | Chrome に読み込ませる拡張の定義 |
| `extension/background.js` | MV3 ES module の入口・イベント登録・手動保存 |
| `extension/background/` | キュー、Save Page Now 通信、重複と履歴の純粋ロジック |
| `extension/shared/` | 初期設定、ストレージ操作、URL 判定、共通 CSS |
| `extension/popup.*` / `extension/options.*` | 日本語のポップアップ・設定画面 |
| `extension/icons/` | ローカル生成 PNG（Git 管理外） |
| `install.sh` | curl で実行する Mac 用インストーラ・更新入口 |
| `scripts/` | アイコン生成・検証、構文と参照チェック |
| `tests/` | 依存なしの単体・回帰テスト |
| `docs/` | 開発時の検証メモ |
| `.github/workflows/` | CI |
