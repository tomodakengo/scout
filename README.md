# scout — Session-Based Exploratory Test Recorder

**scout** is a browser-first, local-only session recorder for exploratory testing (ET) following the SBTM (Session-Based Test Management) workflow: charter definition → timeboxed session → tagged notes → screenshots → debrief → report—entirely client-side, no installation, no account.

---

## 概要（What is scout）

探索的テストの記録と報告を、ブラウザだけで完結させるツール。チャーター（テスト目的）の定義から、セッション実行中のタグ付きメモ・スクショ、デブリーフ、レポート出力まで、SBTM の一連のループを単一の Web アプリケーションで支援します。データはあなたの端末とあなたが指定したフォルダにのみ保存され、外部サーバーに送信されることはありません。

### 4つの設計原則

1. **No server** — サーバーなし、静的配信のみ。DevTools で検証可能。
2. **Files over database** — Markdown + 画像ファイル。ツールが消えてもデータは資産として残る。
3. **BYOクラウド** — OneDrive / Google Drive の同期フォルダに書き込むだけで、チーム共有・自動バックアップが成立。
4. **Keyboard-first** — セッション中はテスト対象に集中。記録操作はすべてキーボード完結。

---

## クイックスタート（Quick Start）

```bash
npm install
npm run dev      # Vite開発サーバー起動
npm test         # テスト実行
npm run build    # 本番ビルド
```

---

## 使い方（Usage）

### 5つの画面フロー

**S1 ホーム（Home）** → **S2 セッション実行（Run）** → **S3 デブリーフ** → **S4 レポート** → （S5 設定）

#### S1: ホーム
- チャーター（テスト目的）を新規作成・管理
- 過去のセッション一覧を表示
- 保存先フォルダの接続状態を確認

#### S2: セッション実行（最重要画面）
- **タグ入力**: 空の入力欄で `b`（バグ）`i`（気づき）`q`（疑問）`n`（メモ）`p`（称賛）を押してタグモード入力
- **モード切替**: F1（テスト）/ F2（バグ調査）/ F3（セットアップ）で時間配分を自動計測（TBS メトリクス）
- **スクショ**: F9 で現在の画面をキャプチャ。注釈（矩形・矢印・モザイク・テキスト）を即座に追加可能
- **タイムライン**: すべてのアクションが `MM:SS [TAG] 本文` の形式で記録される

#### S3: デブリーフ
- TBS メトリクス（テスト / バグ調査 / セットアップの時間比率）
- チャーターカバレッジの自己評価
- 残課題・所感（PROOF フレームワーク）
- すべてスキップ可能

#### S4: レポート
- 形式選択: **Markdown**（デフォルト）/ Jira 記法 / Confluence / Backlog / ZIP（オフライン）
- バグ項目は 1 件ずつコピー可能（Jira 起票時に便利）
- AI による走り書き整形（Pro プラン + BYO API キー）

#### S5: 設定
- 保存先フォルダ選択（File System Access API）
- タグカスタマイズ
- キーバインド
- AI プロバイダ設定

---

## ファイル仕様（File Layout）

### フォルダ構造

```
et-sessions/                                      # ユーザー指定のルート
├── charters/
│   ├── 2026-0001-payment-error-paths.md
│   └── 2026-0002-search-ui-keyboard.md
├── sessions/
│   └── 2026-06-10-1430-payment-error-paths/
│       ├── session.md                           # 本体（frontmatter + タイムライン）
│       ├── report.md                            # 生成レポート
│       └── attachments/
│           ├── 0012-fullscreen.png
│           ├── 0012-annotated.png
│           └── 0047-annotated.png
└── .scout/
    ├── config.yaml
    └── index.json
```

### session.md 例（簡略版）

```markdown
---
charter: 2026-0001
started: 2026-06-10T14:30:00+09:00
duration_minutes: 90
tbs: { test: 56, bug_investigation: 25, setup: 9 }
coverage_percent: 70
schema: scout/1
---
- 00:03 [SETUP] テスト環境にログイン
- 00:11 [TEST] カード番号に全角数字を入力
- 00:12 [BUG] 全角入力時のエラーメッセージがi18n漏れ #i18n
  ![](attachments/0012-annotated.png)
- 00:25 [QUESTION] 3Dセキュア失敗時のリトライ上限は仕様？
```

**タイムライン文法**: `- MM:SS [TAG] 本文`  
タグ: `SETUP / TEST / BUG / QUESTION / IDEA / FINDING / PRAISE`  
スキーマバージョン: `scout/1`

---

## ブラウザ対応（Browser Support）

| ブラウザ | File System Access | getDisplayMedia | 推奨度 |
|---------|-------------------|-----------------|--------|
| Chrome / Edge | ✅ | ✅ | 🟢 推奨 |
| Firefox | ❌ | ✅ | 🟡 部分対応（IDB + ZIP 出力） |
| Safari | ❌ | ❌ | 🟡 IDB のみ（スクショなし） |

File System Access 非対応環境は自動的にブラウザ内ストレージ + ZIP ファイル出力にフォールバック。

---

## ライセンス / Licensing

### Pro プラン

Pro 機能はオフライン検証可能な Ed25519 署名付きライセンストークンで保護されます。運用詳細は [docs/LICENSING.md](docs/LICENSING.md) を参照してください。

---

## ステータス

**v0.1 プロトタイプ** — まだリリースされていません。  
需要検証中（Zenn 記事 + コミュニティヒアリング）。

---

