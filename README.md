# Quoridor Online

Apple 風デザインのコリドール（Quoridor）オンライン対戦 Web アプリ。

- CPU 対戦（弱 / 普通 / 強）
- オンライン 2〜4 人対戦（6 桁ルームコードのみ、ID / パスワード不要）
- 日英 i18n
- Azure Container Apps + Static Web Apps でホスティング

## 構成

| パッケージ | 役割 |
|---|---|
| `packages/engine` | ルールエンジン（盤面・壁・移動・ジャンプ・経路保証・勝利判定） |
| `packages/ai` | CPU（弱 = BFS 最短経路、普通 = 1 手読み、強 = 反復深化 α-β） |
| `packages/server` | Fastify + ws。ルーム管理、再接続、Azure Table Storage スナップショット |
| `packages/web` | React 19 + Vite のフロントエンド |

## 開発

```bash
npm ci
npm run build
npm test

npm run dev:server   # http://localhost:8080
npm run dev:web      # http://localhost:5173
```

`packages/web` は `VITE_SERVER_URL` が未設定なら `http://<現在のホスト>:8080` に接続する。

## デプロイ

シークレットレス。GitHub Actions はユーザー割り当てマネージド ID
`id-quoridor-deploy` に OIDC でフェデレーションし、コンテナイメージは
ghcr.io（public）に置く。

| ワークフロー | 契機 | 内容 |
|---|---|---|
| `ci.yml` | PR / `main` | lint → build → vitest |
| `deploy-server.yml` | `main`（engine / ai / server / Dockerfile） | イメージを ghcr.io に push → 対局中でないことを確認 → `az containerapp update` |
| `deploy-web.yml` | `main`（web / engine） | Container App の FQDN を解決 → Vite build → Static Web Apps に upload |

インフラは Bicep で、変更時のみ手動適用する。

```bash
# 一度だけ: デプロイ用マネージド ID とフェデレーション資格情報
az deployment group create -g rg-quoridor-bootstrap -f infra/bootstrap.bicep

# ワークロード（Container Apps / Storage / Static Web Apps / ロール割り当て）
az deployment group create -g rg-quoridor-online -f infra/main.bicep \
  -p containerImage=ghcr.io/aktsmm/quoridor-online/server:<sha> \
     deployIdentityPrincipalId=<id-quoridor-deploy の principalId>
```

Container App は `minReplicas=0` なので、しばらく誰も遊んでいないと
コールドスタートに 20〜30 秒かかる。フロントは読み込み時に `/health` を
叩いて先に起こし、その間は接続状態を UI に出す。

## Status

🚧 開発中
