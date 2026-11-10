# iris の iPhone アプリ

自分のエージェントに頼んだタスク（毎日決まった時刻に動くもの）とその実行の記録を見て、エージェントにメッセージを送るアプリ（SwiftUI）。サインインは、アプリが開くシートの中でパスキーを使う。

ホームにエージェントが並び、選ぶとそのエージェントの実行が古い順にひと続きのスレッドで見られる。スレッドの下からメッセージを送ると、そのメッセージで始まる実行がスレッドの最後に足される。終わっていない実行（やり直し待ちを含む）があるあいだ、スレッドは 3 秒ごとに読み直して返事を出す。タスクの追加と削除はスレッドの右上から開く。ホームはサーバーにあるエージェントを足した順に並べる。アプリからエージェントを足す画面はまだない。

- `Iris/` はアプリの殻（`App` と素材）だけ。中身はローカルのパッケージ `Packages/Modules` にある。
  - `Backend`：`apps/agent/openapi.json`（シンボリックリンク）から生成したクライアントと、サーバーへの入口 `IrisBackend`（サインイン、トークンの保管と更新）。
  - `Features`：画面とモデル。
- Xcode のプロジェクトは `project.yml` から xcodegen で作る。`project.yml` を変えたら `xcodegen generate` を流す。

```sh
cd apple/Packages/Modules
swift test              # Backend と Features のテスト
```

```sh
apple/scripts/lint.sh   # 整形の確認
```

- Xcode で初めて開くと、OpenAPIGenerator のプラグインを信頼するか聞かれる。コマンドラインで `xcodebuild` するときは `-skipPackagePluginValidation` を付ける。
- 署名をまったくしないビルド（`CODE_SIGNING_ALLOWED=NO`）はキーチェーンに書けず（-34018）、サインインが残らない。シミュレーターで試すビルドは `CODE_SIGN_IDENTITY=-`（アドホック署名）で作る。

```sh
cd apple
xcodebuild build -project Iris.xcodeproj -scheme Iris -destination 'generic/platform=iOS Simulator' \
  -skipPackagePluginValidation CODE_SIGN_IDENTITY=-
```

## つなぐサーバー

アプリは、`openapi.json` の `servers` にあるオリジン（今は `https://iris-agent.marrromugi-dev.workers.dev`）につなぐ。Debug ビルドでは、Xcode のスキームの Run → Arguments → Environment Variables に `IRIS_SERVER_ORIGIN`（例：`https://localhost:8787`）を入れると、そちらにつなぐ。パスキーは https でしか通らないので、手元のサーバーも自己署名の証明書で https で動かし、その証明書をシミュレーターに信頼させる（`xcrun simctl keychain booted add-root-cert <証明書のファイル>`）。はじめてサインインする人には招待が要る。招待の出し方と、サーバーを手元で動かす手順は、サーバーの側（`apps/agent`）に書く。

サインインは OAuth（認可コード + PKCE）。アプリは `/register` で自分を公開クライアントとして登録し、`/authorize` をシートで開き（`resource` は `<origin>/api`）、戻ってきたコードを `/token` でトークンに替えてキーチェーンに置く。サーバーが受け付けるリダイレクトは `dev.marromugi.iris:/oauth` だけ。
