# agent（iris の Worker）

ユーザーごとのエージェントを動かす Cloudflare Worker。ユーザー 1 人に Durable Object（`UserAgent`）が 1 つあり、その人のエージェントとスレッド、タスクと実行の記録、タイムゾーンとスレッドごとの日々のまとめを持つ。スレッドには、エージェントそれぞれの 1 対 1 のスレッドと、2 体以上のエージェントのグループがある。ユーザーがスレッドに発言すると、@ で名前を挙げたメンバー（挙げなければ全員）のうち、停止していないものがそれぞれ実行で返事をする。実行は、同じスレッドでそれより前に始まった実行が終わるのを待つ。同じ発言への返事どうしは待ち合わず、互いの返事を読まない。待つもののない実行は、alarm の 1 回の起床の中で同時に進む（同時に 6 つまで、`MAX_PARALLEL_RUNS`）。起床のあいだに来た発言も、その起床がすぐに拾う。起床は 13 分（`WAKE_UP_BUDGET_MS`）で新しい実行を始めるのをやめ、動いている実行はそのメッセージのあとで止めて、次の起床で続きから進める。モデルは、そのスレッドで前にあった発言と返事を読む（他のエージェントの返事は「名前: 本文」として）。`/api/agents/{agentId}/...` はそのエージェントの 1 対 1 のスレッドに届く。エージェントは `ask_agent` ツールで別のエージェントに相談できる。相談は「相談」のスレッド（実行と相手ごとに 1 つ、ホームには出ない、ユーザーは読むだけ）で行われ、相手の返事がツールの結果として戻る。相談のスレッドの中の実行にはこのツールを渡さないので、相談は 1 段まで。エージェントは `bash` ツールで、自分のサンドボックス（`AgentSandbox`、エージェントごとの Durable Object とコンテナ。インターネットなし）でコマンドを動かせる。`/workspace` は R2 バケット `iris-workspaces` の `agents/<agentId>/` をつないだもので、ファイルは実行をまたいで残る。それ以外は、コンテナが止まると（最後のコマンドから 5 分）消える。1 つのコマンドは 60 秒で止め、出力は末尾 8 KB を返す。イメージは `sandbox/Dockerfile`。エージェントは `web_search` で Web を検索し（Cloudflare の Web Search API。Exa を AI Gateway `default` に預けたキーで使う。上位 5 件）、`browser_open` / `browser_follow` / `browser_read` で Browser Run のブラウザを使う。ブラウザは実行ごとに 1 つで、同じ実行のあいだはリンクをたどってもそのまま。実行が止まると閉じる。検索はユーザーごとに月 1,000 回まで数えて止める（`search_counts`）。はじめは誰でもエージェントを 1 つ持っていて、`POST /api/agents` で名前を付けて足せる。エージェントは見た目（`look`：アプリの配色の番号と、粒子の種）を持つ。サーバーは保つだけで、描くのはアプリ。足すときに渡さなければランダムに決める。エージェントは `POST /api/agents/{agentId}/deactivate` で止められ、`activate` で戻せる。止めているあいだは、返事をせず（そのエージェントしか返事をしない発言は 400 で断る）、タスクも動かず、`ask_agent` の相手にもならない。止めたときに終わっていなかった実行は、返事なしで終わる。何も消さないので、スレッドもタスクも `/workspace` のファイルも残る。戻すと、タスクは今より後の次の時刻から動く（止めていたあいだの分は動かない）。

実行は、タスクの時刻が来るか、エージェントにメッセージが送られると始まる。エージェントの実行はひと続きの会話で、始まった順に 1 つずつ動く。前の実行が終わる（返事が来るか、失敗が続いて諦めるか、エージェントが停止される）まで、次の実行は待つ。モデルは、そのエージェントの前の実行のうち返事まで終わったものを、新しいほうから丸ごと合わせて 40 メッセージまで読んでから、今の実行を読む（`src/runner.ts` の `MAX_EARLIER_MESSAGES`）。読むのは、実行が始まったユーザーの日（下の 4:00 から）の分だけ。モデルの返事は、流れてくるまま受け取る。

ユーザーの 1 日は、そのタイムゾーンの 4:00 から次の 4:00 まで（`src/day.ts`）。タイムゾーンは `PUT /api/me/time-zone` で設定し、設定されるまでは Asia/Tokyo。日が終わると、その日に発言かタスクの実行があったスレッドごとに、モデルがその日のまとめを書いて `daily_summaries` に残す（`src/daily-summary.ts`。相談のスレッドは除く）。モデルが読むのはユーザーの発言、タスクのプロンプト、返事の本文で、ツールの呼び出しと結果、考えた記録は入れない。まとめは、そのスレッドでその日の終わりより前に始まった実行がすべて終わってから書く。失敗したら 5 分後にやり直し、3 回失敗したらその日は飛ばす。まとめは alarm の起床で、実行と並んで書く。まとめを書いたら、その日のスレッドのメンバーそれぞれの `/workspace/history/` に、会話を `<日付>.log.md`、まとめを `<日付>.md` として書く。3 回失敗して見送った日は、会話（`.log.md`）だけを書く。タイムゾーンが変わって前のまとめと日付が同じになった日は `<日付>-2` のように番号を付ける。1 対 1 のスレッドは `history/` の直下、グループは `history/groups/<スレッド ID>/` の下。Worker は R2 バインディング `WORKSPACES`（`S3_BUCKET` と同じバケット）で直接書く。ファイルは Durable Object にあるものの写しで、書けなかったものはログに出して飛ばす。エージェントには読むだけにするよう伝えるが、マウントは読み書きできるので、消したり書き換えたりしても元には戻らない（元データは Durable Object に残る）。手元の `pnpm dev` と `test:live` では、`WORKSPACES` は手元の R2 になり、サンドボックスがつなぐ本物の R2 とは別なので、書いた履歴はエージェントの `/workspace` に現れない。エージェントにはシステムプロンプトで、古いことはここを grep するよう伝える。

実行は、スレッドの前の日の分を読まない代わりに、そのスレッドの、自分の日の前 7 日間のまとめ（書けたものだけ、古い順、日付つき）をシステムプロンプトの最後で読む（`src/system-prompt.ts`）。どちらも実行が始まった時刻から決まるので、実行が次の起床に続いても変わらない。日が終わったあとに始まった実行は、そのスレッドの終わった日のまとめがまだ書けていない（やり直し待ちを含む）あいだ待ち、書けたら読んで始まる。まとめのほうは日の終わりより前に始まった実行しか待たないので、互いに待ち合うことはない。相談のスレッドは日で切らず、まとめも読まない。

モデルは `wrangler.jsonc` の `MODEL_PROVIDER` で選ぶ。`anthropic`（初期値）なら Claude Haiku 5.5（`src/anthropic-model.ts`、鍵は secret の `ANTHROPIC_API_KEY`）、`workers-ai` なら Workers AI の GLM-4.7-Flash（`src/workers-ai-model.ts`、AI バインディング）。Claude の考えた記録（thinking）は、返事のメッセージに `reasoning` の部分として残り、同じ実行の続きでモデルに送り返す。アプリへの `/api` と、あとの実行が読む前の会話には入れない。記録は、それより前のシステムプロンプト・ツール・会話がそのときと同じときだけ使われる。システムプロンプトには時刻を入れず、実行が始まった日（UTC）だけを書くので、実行のあいだは日をまたいでも変わらず、起床をまたいで続く実行（再試行、時間切れ、相談待ち）でも記録とプロンプトキャッシュが生きる。今の時刻が要るときは、エージェントが `date` で調べる。ツールの説明はエージェントの名前を並べるので、実行が待っているあいだにエージェントが足されると、API が前の記録を捨てて続ける（`thinking-binding-controls` のベータ。捨てた分は `console.warn` に出る）。Claude が断った返事、途中で切れた返事、文字もツール呼び出しもない返事は、実行の失敗になる。

アプリは `/api` で読み書きする。`/api` の定義は `openapi.json` に書き出してあり、アプリのクライアントはここから作る。`GET /api/agents/{agentId}/events` を WebSocket で開くと、そのエージェントの実行が変わるたびにその実行が、実行のあいだは「起動中」「考え中」「書いている途中の文字」が届く（`RunEvent`、`src/run-broadcast.ts`）。途中の文字を送る間隔は `WRITING_EVERY_MS`（`src/api/schemas.ts`）まで。保存するのは返事ができてから。アプリは、ソケットを開いてから実行を読む（開く前に起きたことは届かない）。ソケットは Durable Object の休止を妨げない。

## メール

ユーザーは Gmail などから、自分のアドレス `iris+<タグ>@marromugi.me` にメールを転送できる。タグは 24 桁の16進数で、ユーザーごとに D1 の `users.mail_tag` にある。Email Routing のルール（`wrangler.jsonc` の `addresses`）が `iris@marromugi.me` 宛てを Worker の `email` ハンドラに渡し、ハンドラはタグからユーザーを引いて、そのユーザーの Durable Object にメールを置く（`src/mail/`）。持っているユーザーのいないアドレス宛てと、読めないメールは送り主に返す。置くのは送り主、件名、本文のテキスト（プレーンテキストがなければ HTML から作る。5 万字ほどで切る）、添付の名前だけ。メールは届いてから 7 日（`MAIL_KEPT_DAYS`）で消える。消すのは次のメールが届いたときで、それまでもツールには 7 日より前のものは見えない。

エージェントはどれも `mail_list`（届いた時刻の範囲で、新しい順に 100 通まで）と `mail_read`（1 通の本文）でメールを読む。中身は送り主が書いたものとして、指示ではなく材料としてモデルに渡す。

アプリは `GET /api/me/mail` でメールの状態（アドレス、Gmail の転送の確認、最後にメールが届いた時刻）を読み、`POST /api/me/mail/address` でアドレスを作る（作り直すと前のアドレスは使えなくなり、確認と最後の時刻は消える。置いたメールは残る）。`DELETE /api/me/mail/address` で受け取りをやめる（アドレスと置いたメールが消える）。Gmail の転送の確認メール（送り主 `forwarding-noreply@google.com`）はエージェントに見せず、確認リンクと件名のコードだけを取り出してメールの状態に置く。確認は、そのあとにふつうのメールが届くと消える。`GET /api/me/events` を WebSocket で開くと、メールの状態が変わるたびに `{ "type": "mail" }` が届く（`UserEvent`、`src/user-events.ts`）。アプリはそれを受けて `/api/me/mail` を読み直す。

メールのために、デプロイの前にダッシュボードの Email Service → Email Routing → Settings で `marromugi.me` の subaddressing を有効にする（一度だけ）。これがないと `iris+<タグ>@` 宛てが `iris@` のルールに当たらない。ルール自体は `wrangler deploy` が `addresses` から作る。

7 日で消えるのは置いたメールだけで、エージェントがツールで読んだ中身は、その実行の会話として残る。

Gmail の転送先に登録すると、確認のメールがそのアドレスに届く。エージェントに「確認コードを教えて」と頼めば `mail_read` で読める。

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

`pnpm dev` は `--local` で動くので、リモートのバインディングを使わず、Workers AI も呼ばない。`MODEL_PROVIDER` が `anthropic` なら、`apps/agent/.dev.vars` に `ANTHROPIC_API_KEY=<鍵>` を書くと Claude を呼ぶ（その鍵の料金がかかる）。書かなければ、タスクの登録や一覧は確かめられるが、モデルを呼ぶ実行は確かめられない。モデルとのやりとりは `pnpm --filter @iris/agent-worker test:live` で見る。Workers AI と Claude の両方を呼ぶので、両方の料金がかかり、Claude には同じ鍵が要る。`MODEL_PROVIDER=workers-ai ANTHROPIC_API_KEY=invalid pnpm --filter @iris/agent-worker test:live user-agent` とすると、Worker の組み立てを通るチェックが Workers AI で動き、Claude に届かないことも確かめられる（環境変数が `wrangler.jsonc` と `.dev.vars` より優先される）。

## デプロイ

本番は `https://iris-agent.marrromugi-dev.workers.dev`。D1 データベース `iris` と KV 名前空間 `iris-oauth` は作ってあり、その ID が `wrangler.jsonc` にある。D1 の ID は、招待のスクリプト（`invite`）が使う `scripts/d1.jsonc` にもある（`--remote` のときだけ本番に届く。`wrangler login` が要り、そのあいだアカウントに一時的なプレビューの Worker が立つ）。D1 のマイグレーションを足したら、デプロイの前に本番にも当てる。

```sh
cd apps/agent
pnpm exec wrangler d1 migrations apply iris --remote
pnpm exec wrangler deploy
pnpm --filter @iris/agent-worker invite <名前> --remote   # 本番の D1 に招待を出す
```

Claude を使うために、デプロイの前に API キーを `pnpm exec wrangler secret put ANTHROPIC_API_KEY` に入れる（一度だけ）。鍵は Claude Console で作る。API はクレジットの前払いで、残高がなくなると呼べなくなる。`MODEL_PROVIDER` が `workers-ai` でも、`wrangler.jsonc` が鍵を必須にしているので入れておく。

bash ツールとエージェントの履歴（`WORKSPACES` バインディング）のために、デプロイの前に次が要る（一度だけ）。

- R2 バケット `iris-workspaces`（`pnpm exec wrangler r2 bucket create iris-workspaces`）。
- そのバケットだけに「Object Read & Write」の R2 API トークン。ダッシュボードで作り、`pnpm exec wrangler secret put S3_ACCESS_KEY_ID` と `S3_SECRET_ACCESS_KEY` に入れる。コンテナには渡らず、Worker が保存先への要求に署名するのに使う。
- `wrangler deploy` と `pnpm dev`、`test:live` のときに Docker が動いていること（サンドボックスのイメージを作る）。
- Web 検索のために、Exa の API キー（カードを登録しないアカウント。無料枠を使い切ると Exa が止める）を、ダッシュボードの AI Gateway → `default` → Provider Keys に、別名 `default` で登録する。キーは Worker には入らない。

`ORIGIN` は Worker が配られる URL と同じにする（`src/api/api.ts` の `PRODUCTION_ORIGIN` とも同じで、`openapi.json` のテストがそれを確かめる）。

- `/api` のパスや形を変えたものをデプロイするときは、アプリも同じコミットから作り直して入れ替える。前のビルドのアプリは、変わったところを読めなくなる。
- Claude が動くと、保存されるメッセージに `reasoning` の部分が入る。`reasoning` を知らない前のバージョンの Worker に戻すと、それを含む実行と、それを前の会話として読む実行は読めずに失敗する。
- Durable Object のマイグレーション（`drizzle/`）は、デプロイのあと各ユーザーの Durable Object が次に開いたときに当たる。当たったあとは、そのマイグレーションを知らない前のバージョンの Worker に戻すと、そのユーザーの Durable Object は開けなくなる（`store.migrate` が新しいストレージを拒む）。
