# scout ライセンス運用ガイド

## 概要

scout の Pro プラン機能は **SCOUT1 形式の Ed25519 署名付きライセンストークン**で保護されます。

**トークン形式**: `SCOUT1.<base64url(payload)>.<base64url(sig)>`

**ペイロード構造**（JSON）:
```json
{
  "v": 1,
  "lid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "sub": "user@example.com",
  "plan": "pro",
  "iat": 1718000000,
  "exp": 1750000000,
  "kid": "k1"
}
```

| フィールド | 説明 |
|-----------|------|
| `v` | スキーマバージョン（現在は 1） |
| `lid` | ライセンス ID（失効処理用ハンドル） |
| `sub` | 購入者メールアドレス（licensee） |
| `plan` | プラン名（現在は `pro` のみ） |
| `iat` | 発行日時（Unix 秒） |
| `exp` | 有効期限（Unix 秒） |
| `kid` | 署名に用いた公開鍵の ID |

---

## 脅威モデル（正直に）

### ✅ 暗号学的に防御可能

- **鍵の偽造**: Ed25519 署名により、秘密鍵がなければ有効な新規トークンは生成不可

### ❌ 原理的に防御不可

- **クライアント改ざん**: scout は完全クライアントサイドアプリのため、ユーザーがブラウザの DevTools やローカルコピーを改ざんすれば、ライセンスチェックを回避できる

### 設計判断

このため **長期的な実効性は更新エンドポイント＋失効リスト（renewal/revocation）で担保する** アーキテクチャを採用。
- オフライン動作をサポートするため、有効期限から 14 日間は失効後も Pro 機能が利用可能（grace period）
- その後の継続利用には、定期更新エンドポイントへのアクセスが必須
- 失効・課金停止時は REVOKED リストに登録、次回更新を 403 で拒否

---

## 運用手順（ベンダー側）

### 1. 鍵ペアの生成

```bash
node tools/license-keygen.mjs gen-keypair
```

出力例:
```
private (SECRET — wrangler secret / vault): xxxxxxxxxxxxxxxx...
public  (PUBLIC_KEYS / VITE_LICENSE_PUBKEY_K1): yyyyyyyyyyyyyyyy...
```

**秘密鍵**: Cloudflare Workers の `wrangler secret`、または組織のシークレット管理（Vault など）に保管。**リポジトリには絶対に commit しない**。

**公開鍵**: `src/lib/license.ts` の `PUBLIC_KEYS` に登録、または ビルド時環境変数 `VITE_LICENSE_PUBKEY_K1` で注入。

### 2. ライセンスの発行

```bash
node tools/license-keygen.mjs sign \
  --key <秘密鍵 hex> \
  --email buyer@example.com \
  --days 365 \
  [--lid <任意 UUID>] \
  [--kid k1]
```

標準出力にトークンが出力される。これを購入者に配布。

### 3. トークンの検証（手動確認）

```bash
node tools/license-keygen.mjs verify \
  --pub <公開鍵 hex> \
  --token SCOUT1.xxx.yyy
```

署名とペイロードの整合性を確認。

### 4. 鍵ローテーション

新しい秘密鍵が必要な場合:

1. 新しいキーペアを生成
2. `kid` を新しい ID（e.g., `k2`）として記録
3. 新しい公開鍵を `PUBLIC_KEYS` に追加（旧キーは削除しない）
4. 新規発行から新しい鍵を使用
5. 旧鍵で発行したライセンスは旧 `kid` で検証される（互換性維持）

---

## 自動更新フロー（クライアント側）

### タイミング

- **更新ウィンドウ**: 有効期限の 7 日前から grace period（失効 + 14 日）まで
- **スロットル**: 6 時間に 1 回まで（起動時 + 6 時間毎）
- **強制更新**: 設定画面の「今すぐ更新」ボタンで throttle をバイパス

### ネットワーク送信内容

```javascript
POST https://<VITE_LICENSE_RENEWAL_URL>
Content-Type: application/json

{ "token": "SCOUT1.xxx.yyy" }
```

**重要**: このエンドポイントへのネットワーク通信 **のみ** がプライバシー原則の唯一の例外。session/user ID などは **一切送信されない**。

### レスポンス処理

```json
{ "token": "SCOUT1.aaa.bbb" }
```

サーバーが返したトークンに対して **クライアント側で再検証**:
- 署名の正当性確認
- 同一 `lid` / `sub` であることを確認
- 新しい `exp` が古いトークンより後ろであることを確認

すべて OK なら、ローカルストレージに保存。失敗時は古いトークンを保持。

---

## 更新サーバーの構築

### デプロイ対象: Cloudflare Workers

`server/license-worker.example.mjs` を参考に実装。

### 初期セットアップ

```bash
# 1. 秘密鍵をシークレットに登録
wrangler secret put LICENSE_PRIVATE_KEY
# プロンプトで秘密鍵 hex を入力

# 2. REVOKED KV namespace の作成・バインド（オプション）
wrangler kv:namespace create "REVOKED"
# wrangler.toml に KV binding を追加

# 3. ALLOWED_ORIGIN を設定（CORS対応）
# wrangler.toml で env.ALLOWED_ORIGIN を指定
```

### エンドポイント動作

**POST /renew** リクエスト受け取り → 以下の順序で検証:

1. トークン形式チェック（`SCOUT1.*.*.`）
2. 署名検証（秘密鍵で再署名して比較）
3. 失効時刻チェック（MAX_RENEW_AFTER_EXP_DAYS = 90 日以内なら OK）
4. REVOKED KV に `lid` が存在するか確認 → 存在すれば 403 revoked
5. **[TODO] 課金連携**: Stripe / 内部 DB で subscription status 確認 → 失効済みなら 403 unpaid
6. ペイロード更新（`iat` = now、`exp` = now + RENEW_DAYS）
7. 新トークンに署名
8. 200 OK で返却

### 失効リスト管理

```bash
# 失効させる
wrangler kv:key put REVOKED "xxxxxxxx-xxxx-..." --namespace-id=<ID>

# 失効解除
wrangler kv:key delete REVOKED "xxxxxxxx-xxxx-..." --namespace-id=<ID>

# リスト確認
wrangler kv:key list --namespace-id=<ID>
```

---

## Grace Period（猶予期間）と失効

| 状態 | 条件 | Pro 機能 |
|------|------|---------|
| **valid** | `now < exp` | ✅ 利用可能 |
| **grace** | `exp ≤ now < exp + 14 日` | ✅ 利用可能（更新エンドポイントへのアクセスを試み続ける） |
| **expired** | `now ≥ exp + 14 日` | ❌ ロック |
| **revoked** | REVOKED に `lid` が登録 | 次回更新で 403 → grace period 後に ❌ ロック |

grace period は **オフライン初出アプリ**という設計選択をサポート。
更新サーバーに到達できない環境でも 2 週間は機能を使い続けられます。

---

## トラブルシューティング

### Q: 新しい公開鍵を設定したが、古いトークンで 403 が返る

**A**: `kid` 値を確認。古いトークンの `kid` と一致する公開鍵が `PUBLIC_KEYS` に存在するか。
複数バージョンの鍵を同時サポートする場合、旧公開鍵を `PUBLIC_KEYS` から削除しないでください。

### Q: ユーザーが Grace period 中に更新エンドポイントに接続できない

**A**: 設計通り。Pro 機能は 14 日間は利用可能。
ネットワーク復帰後の次回起動 / 強制更新で再検証。

### Q: ローカルストレージが破損したら

**A**: トークン再発行。ユーザーが新トークンをペーストすれば OK。

---

## リファレンス

- **クライアント**: `src/lib/license.ts`（検証）、`src/lib/licenseRenewal.ts`（更新）
- **発行 CLI**: `tools/license-keygen.mjs`
- **更新サーバー**: `server/license-worker.example.mjs`
