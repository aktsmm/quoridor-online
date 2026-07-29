# こりこり (Korikori - Wall Race)

Apple 風デザインの「壁でふさぐ陣取りレース」オンライン対戦 Web アプリ。

> コリドール（Gigamic 社）に着想を得た非公式の対戦ゲームです。Gigamic 社とは関係ありません。
> ルール以外の画像・文章・コードはすべて自作です。

**▶ <https://zealous-rock-0e6198c00.7.azurestaticapps.net/>**

- CPU 対戦（弱 / 普通 / 強）
- オンライン 2〜4 人対戦（6 桁ルームコードのみ、ID / パスワード不要）
- モード切替なしの盤面操作（マスを押せば移動、溝を押せば壁）
- どの席でも自分が手前に来る視点／全員のゴールを席の色で強調
- 3〜4 人戦は最後の 1 人が決まるまで続き、ゴールした順に順位が付く
- 壁を使い切ったら投了できる（確認あり）
- 途中からの観戦（1 ルームにつき 10 人まで）／終局後もルームに残って連戦
- 日英 i18n
- Azure Container Apps + Static Web Apps でホスティング

## 盤面操作

モード切替ボタンはない。ポインタの位置だけで「移動」か「壁」かを決める。

| ポインタの位置 | 解釈 |
|---|---|
| 合法な移動先マスの内側 | かならず移動（マスの隅でも壁にはならない） |
| 溝、および移動先ではない隣のマスの端（0.35 マス以内） | 壁 |
| それ以外 | 何も選ばない |

移動先マスは面積の 100% が移動なので「移動のつもりで押したら壁ができた」が起きない。
かわりにマス中央付近には何も選ばれない空白ができるので、盤上どこを指しても常に
どこかがハイライトされ続ける落ち着かなさもない。

これで合法な壁が掴めなくなることはない。溝は 4 マスに接するが、指し手自身の駒がいる
マスは移動先に含まれないので、かならず移動先ではない側が残る。
`packages/web/test/boardTarget.test.ts` の到達性テストがこれを保証しているので、
`legalWalls` の順序を変えるなどして壊れたら落ちる。

いま何が起きるのかは盤全体で示す。移動ならカーソルが `pointer` になり、行き先に
ゴースト駒と移動線が出て対象マスが大きく太くなる。壁なら `row-resize` / `col-resize`
になり、移動候補が薄れて壁バーだけが濃く脈打つ。

確定のしかたは入力デバイスで変える。マウスは押した座標で決めるので、離す瞬間の数 px の
ずれで別の手にならない（溝の上ならクリックだけで壁が置ける）。指とペンは誤爆しやすいので、
なぞるか長押しした場合だけ壁になる。

## 構成

| パッケージ | 役割 |
|---|---|
| `packages/engine` | ルールエンジン（盤面・壁・移動・ジャンプ・経路保証・順位判定） |
| `packages/ai` | CPU（弱 = 1 手読み、普通 = 浅い反復深化 α-β、強 = 反復深化 α-β 全力） |
| `packages/server` | Fastify + ws。ルーム管理、再接続、Azure Table Storage スナップショット |
| `packages/web` | React 19 + Vite のフロントエンド |

`packages/ai` はレベル名とエンジン名を分けている。BFS で最短経路を歩くだけの `greedy` は
どのレベルにも割り当てず、AI ワーカーが落ちたときのサーバー側フォールバックに使う。

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

インフラは Bicep で、変更時のみ手動適用する。リポジトリ名と Azure リソース名は
`quoridor` のまま（作り直しのコストに見合わないため、変更したのは表示名だけ）。

```bash
# 一度だけ: デプロイ用マネージド ID とフェデレーション資格情報
az deployment group create -g rg-quoridor-bootstrap -f infra/bootstrap.bicep

# ワークロード（Container Apps / Storage / Static Web Apps / ロール割り当て）
az deployment group create -g rg-quoridor-online -f infra/main.bicep \
  -p containerImage=ghcr.io/aktsmm/quoridor-online/server:<sha> \
     deployIdentityPrincipalId=<id-quoridor-deploy の principalId>
```

Container App は `minReplicas=0` なので、しばらく誰も遊んでいないと
コールドスタートが起きる。実測で約 35 秒（うち約 27 秒が ACA のプロビジョニングと
イメージ pull）。フロントは読み込み時に `/health` を叩いて先に起こし、
その間は接続状態を UI に出す。

## Status

稼働中。Web は Static Web Apps（Free）、ゲームサーバーは Container Apps
（`minReplicas=0` / `maxReplicas=1`、0.25 vCPU / 0.5 GiB）。
