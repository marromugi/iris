# agent（iris の Worker）

ユーザーごとのエージェントを動かす Cloudflare Worker。ユーザー 1 人に Durable Object（`UserAgent`）が 1 つあり、その人のタスクと実行の記録を持つ。アプリは `/api` で読み書きする。`/api` の定義は `openapi.json` に書き出してあり、アプリのクライアントはここから作る。

## サインイン

Worker は OAuth の認可サーバーでもある（`@cloudflare/workers-oauth-provider`）。トークンの宛先は `<ORIGIN>/api` だけ。

- アプリは `/register` で自分を登録する。受け付けるのは、シークレットを持たないクライアントで、リダイレクト先が `dev.marromugi.iris:/oauth` だけのものに限る。
- アプリは `/authorize` を PKCE（S256）付きで Web のシートに開く。シートのページはパスキーでサインインする。はじめての人は招待の鍵を入れてパスキーを作る。鍵は 1 回だけ使え、7 日で切れる。
- アプリは `/token` でコードをトークンに換える。アクセストークンは 1 時間、更新トークンは最初のサインインから 30 日使える。
- ユーザー、パスキー、招待は D1 にある。ユーザーの ID が、その人の Durable Object の名前になる。
- サインインを始める呼び出し（`/register`、`/authorize`、パスキーのチャレンジを出すもの）は、IP ごとに 1 分 10 回まで。

## コマンド

```sh
pnpm test                                            # リポジトリのルートで。手元の workerd で動き、Cloudflare には届かない
pnpm --filter @iris/agent-worker openapi             # /api を変えたら openapi.json を書き直す
pnpm --filter @iris/agent-worker db:generate         # src/db/schema.ts（Durable Object）を変えたらマイグレーションを作る
pnpm --filter @iris/agent-worker d1:generate         # src/users/schema.ts（D1）を変えたらマイグレーションを作る
pnpm --filter @iris/agent-worker d1:migrate:local    # 手元の D1 にマイグレーションを当てる
pnpm --filter @iris/agent-worker invite <名前>       # 手元の D1 に招待を出し、鍵を表示する
pnpm --filter @iris/agent-worker dev                 # https://localhost:8787 で動かす（下の準備が要る）
```

招待の鍵は表示されたときにしか見られない。D1 には鍵のハッシュしか残らない。

## 手元で動かす

パスキーは https でしか通らず、サインインのページが使う Cookie（`__Host-` 付き）も https でしか置かれない。そこで、サーバーを自己署名の証明書で https で動かし、その証明書をシミュレーターに信頼させる。

```sh
mkdir -p ~/.iris-dev && cd ~/.iris-dev
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost" -addext "basicConstraints=critical,CA:TRUE" -addext "extendedKeyUsage=serverAuth"
xcrun simctl keychain booted add-root-cert cert.pem
```

```sh
pnpm --filter @iris/agent-worker d1:migrate:local
pnpm --filter @iris/agent-worker invite 花子
pnpm --filter @iris/agent-worker dev
```

`pnpm dev` は `ORIGIN` を `https://localhost:8787` にして動かす。サーバーは、トークンの宛先とパスキーの RP ID（`localhost`）をここから決める。アプリは Debug ビルドで、スキームの環境変数 `IRIS_SERVER_ORIGIN=https://localhost:8787` を渡して動かす。手元の D1 と KV は `.wrangler/state` にあり、再起動しても残る。

`pnpm dev` は `--local` で動くので、リモートのバインディングを使わず、Workers AI も呼ばない。タスクの登録や一覧は確かめられるが、モデルを呼ぶ実行は確かめられない。モデルとのやりとりは `pnpm --filter @iris/agent-worker test:live`（Workers AI の料金がかかる）で見る。

## デプロイの前に

`wrangler.jsonc` の D1（`database_id`）と KV（`OAUTH_KV` の `id`）は手元用の仮の値。デプロイの前に D1 データベース `iris` と KV 名前空間を作り、その ID に置き換える。D1 のマイグレーションは本番にも当てる。

```sh
cd apps/agent
pnpm exec wrangler d1 migrations apply iris --remote
pnpm exec wrangler deploy
pnpm --filter @iris/agent-worker invite <名前> --remote   # 本番の D1 に招待を出す
```

`ORIGIN` は Worker が配られる URL と同じにする（`src/api/api.ts` の `PRODUCTION_ORIGIN` とも同じで、`openapi.json` のテストがそれを確かめる）。
