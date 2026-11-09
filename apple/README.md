# iris の iPhone アプリ

自分のエージェントに頼んだタスク（毎日決まった時刻に動くもの）と、その実行の記録を見るアプリ（SwiftUI）。サインインは、アプリが開くシートの中でパスキーを使う。

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

アプリは `https://iris-agent.marrromugi-dev.workers.dev` につなぐ。Debug ビルドでは、スキームの環境変数 `IRIS_SERVER_ORIGIN` にオリジン（例：`https://localhost:8787`）を入れると、そちらにつなぐ。パスキーは https でしか通らないので、手元のサーバーも https で動かし、その証明書をシミュレーターに信頼させる（`xcrun simctl keychain booted add-root-cert cert.pem`）。

サインインは OAuth（認可コード + PKCE）。アプリは `/register` で自分を公開クライアントとして登録し、`/authorize` をシートで開き（`resource` は `<origin>/api`）、戻ってきたコードを `/token` でトークンに替えてキーチェーンに置く。サーバーが受け付けるリダイレクトは `dev.marromugi.iris:/oauth` だけ。
