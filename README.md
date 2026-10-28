# 🎮 AI × Robloxプログラミング塾 — Version 1.5 MVP

小中学生がRoblox Studioでゲームを作りながら、**答えではなくヒントをくれるAI先生**と一緒に考えるWebアプリです。

- 生徒：質問＋Luauコード＋Studioのスクリーンショット → AI先生（段階的ヒント・3択の理解チェック）
- 先生：🔴🟡🟢 で「今、誰を助けに行けばいいか」が分かるダッシュボード（ルールベース判定）
- 保護者：**別アプリ（普通のHTML, `parent/`）**。LINEでログインして、授業ごとの「AIによるまとめ」と「実測値の記録」をスマホで確認

設計の詳細は [docs/DESIGN.md](docs/DESIGN.md)。

```
web/        生徒・先生アプリ（Vite + React + TypeScript）
parent/     保護者ページ（ビルド不要のHTML/JS。LINEログイン）
supabase/   migrations（DB / RLS / RPC / Storage）, seed, Edge Functions（tutor, end-session）
scripts/    アカウント一括作成
```

## まず画面を見る（Supabase不要）

```bash
npm install
```
```bash
npm run dev
```
`http://localhost:5173/#/preview` を開くと、モックデータで生徒・先生・保護者の画面を操作できます（開発時のみ。AIの返事は定型文）。

## セットアップ

### 1. Supabase プロジェクト
1. https://supabase.com でプロジェクトを作成
2. **Authentication → Sign In / Providers → "Allow new users to sign up" をOFF**（アカウントはスクリプトで作成します。ロールの自己申告を防ぐため）
3. CLIでリンクしてDBを反映
```bash
npx supabase login
```
```bash
npx supabase link --project-ref <your-project-ref>
```
```bash
npx supabase db push --include-seed
```

### 2. Edge Functions と OpenAI
```bash
cp supabase/functions/.env.example supabase/functions/.env
```
`.env` に `OPENAI_API_KEY` と `TUTOR_MODEL=gpt-6-luna` を設定してから:
```bash
npx supabase secrets set --env-file supabase/functions/.env
```
```bash
npx supabase functions deploy tutor end-session project
```
OpenAI API Key は Edge Function の Secret にだけ置かれ、ブラウザには一切渡りません。

### 3. アカウント作成
`scripts/users.example.json` をコピーして `scripts/users.json` を作り、先生・生徒・保護者を書きます（`users.json` は git 管理外）。
Windows（PowerShell）では1行ずつ:
```bash
$env:SUPABASE_URL="https://<ref>.supabase.co"
```
```bash
$env:SUPABASE_SERVICE_ROLE_KEY="<secret または service_role キー>"
```
```bash
npm run users -- scripts/users.json
```
Mac / Linux では:
```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npm run users -- scripts/users.json
```
secret / service_role キーは管理者用です。ファイルに書いたり、人に共有したりしないでください。
パスワードを書かなかったアカウントは自動生成され、`scripts/users.credentials.csv`（git管理外）に出力されます。
ログインIDに `@` が無い場合は `<ID>@juku.local` として扱われます（`LOGIN_DOMAIN` / `VITE_LOGIN_DOMAIN` で変更可）。

### 3.5 保護者ページ（LINEログイン）
1. [LINE Developers](https://developers.line.biz/console/) でプロバイダーを作り、**LINEログイン** チャネルを作成（アプリタイプ：ウェブアプリ）
2. チャネルの「LINEログイン設定」→ **コールバックURL** に保護者ページのURLを登録（例：`https://<ユーザー名>.github.io/<リポジトリ名>/parent/`、ローカル確認用に `http://localhost:5174/`）
3. 「チャネル基本設定」の **チャネルID** と **チャネルシークレット** を `supabase/functions/.env` に書く（`LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET`）
```bash
npx supabase secrets set --env-file supabase/functions/.env
```
```bash
npx supabase functions deploy line-login --no-verify-jwt
```
4. チャネルを **「公開済み」** にする（「開発中」のままだと、チャネルの管理者しかログインできません）
5. 招待リンクを作る：アカウント作成スクリプトを実行するときに `PARENT_APP_URL` を設定すると、まだLINE連携していない保護者ごとの**招待リンク**（14日有効・1回だけ使える）が `scripts/users.credentials.csv` に出力されます。
```bash
$env:PARENT_APP_URL="https://<ユーザー名>.github.io/<リポジトリ名>/parent/"
```
6. 保護者は招待リンクを開いて「LINEでログイン」→ 連携完了。次回からはページを開いてLINEでログインするだけです。

ローカルで見た目を確認するには `npm run dev:parent` → `http://localhost:5174/?demo=1`（サンプルデータ表示）。
本番に接続する場合は `parent/config.example.js` を `parent/config.js` にコピーして値を入れます（GitHub Pages では自動生成）。

### 4. Web アプリ
```bash
cp web/.env.example web/.env.local
```
`VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY`（anon / publishable key）を設定して `npm run dev`。

### 5. GitHub Pages へデプロイ
`.github/workflows/deploy-pages.yml` が `main` への push でビルド・デプロイします。
リポジトリの **Settings → Pages → Source: GitHub Actions** にし、**Settings → Secrets and variables → Actions → Variables** に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `LINE_CHANNEL_ID` を登録してください。
生徒・先生アプリは `/<リポジトリ名>/`、保護者ページは `/<リポジトリ名>/parent/` に公開されます。
Supabase の **Authentication → URL Configuration** の Site URL に Pages のURLを追加します。

## ローカル Supabase で動かす（任意・Docker必要）
```bash
npx supabase start
```
表示された API URL / anon key を `web/.env.local` に、service_role key で `npm run users` を実行。
```bash
npx supabase functions serve --env-file supabase/functions/.env
```

## テスト
```bash
npm test
```
ヒント上限ルール、AI出力の検証、RobloxContext→モデル入力、実測値の集計、先生画面の状態判定、Luauハイライトをテストしています。

## 授業の流れ（MVP完成条件との対応）
1. 生徒ログイン → 2. レッスンを選んでAI先生画面 → 3〜5. 質問・コード・スクショ（ファイル選択 / ドラッグ&ドロップ / Ctrl+V）
→ 6〜7. `tutor` 関数が gpt-6-luna に送信し初心者向けに回答 → 8. `messages` に保存
→ 9. 先生ダッシュボードで状態確認 → 10. 生徒「おわる」or 先生「授業を終了」
→ 11. `end-session` 関数が保護者向けSummaryを生成 → 12. 保護者ページ（LINEログイン）で確認

## Version 2 に向けて
AI先生は `RobloxContext`（`supabase/functions/_shared/contracts.ts`）だけを入力として扱います。
Studio Plugin / MCP からの `projectTree` / `currentScript` / `errors` は、Web側に新しい `RobloxContextSource` を追加するだけで渡せます（`web/src/context/`）。Tutor のプロンプト組み立て（`buildInput.ts`）は既にこれらのフィールドに対応済みです。
