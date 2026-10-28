# AI × Robloxプログラミング塾 — Version 1.5 MVP 設計

> 最重要原則: **AIにゲームを作らせるのではなく、AIが状況を理解して、生徒自身に考えさせる。**

## 0. モデル調査結果（OpenAI公式ドキュメント, 2026-10-03 確認）

| 項目 | 内容 |
|---|---|
| Model ID | `gpt-6-luna`（スナップショット指定なし） |
| Endpoint | Responses API `POST /v1/responses`（Chat Completions / Batch も可） |
| 入力 | text + image（`input_image` に URL または `data:image/...;base64,...`、`detail`: `low`/`high`/`original`/`auto`）。PNG / JPEG / WEBP / 非アニメGIF |
| Structured Outputs | 対応。`text.format = { type: "json_schema", name, strict: true, schema }`。全プロパティ required・`additionalProperties: false` |
| reasoning.effort | `none` / `low` / `medium`(既定) / `high` / `xhigh` / `max` |
| 制約 | reasoning.effort が `none` 以外のとき `temperature` / `top_p` / `top_logprobs` は指定不可 |
| コンテキスト | 1,050,000 tokens（入力最大 922,000 / 出力最大 128,000） |
| 料金 (1M tokens) | 入力 $0.10 / キャッシュ入力 $0.01 / 出力 $0.50 |
| Rate limit (Tier1) | 500 RPM / 500,000 TPM |

出典: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) · [Using GPT-6](https://developers.openai.com/api/docs/guides/latest-model) · [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) · [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

モデル名はコードに書かず、Edge Function の環境変数 `TUTOR_MODEL` / `SUMMARY_MODEL` で指定する（`SUMMARY_MODEL` 未設定時は `TUTOR_MODEL` を使用）。

---

## 1. Architecture

```
┌──────────────────────────┐        ┌───────────────────────────── Supabase ─────────────────────────────┐
│ Web App (静的ホスティング)  │        │                                                                     │
│ Vite + React + TS         │──Auth──▶ Auth (email/password, 公開サインアップ無効)                          │
│                           │──REST──▶ PostgreSQL + RLS  (読み取り / 小さなRPC)                            │
│  ┌──────────────────────┐ │──Upload▶ Storage: screenshots (private, RLS)                                │
│  │ RobloxContextSource  │ │        │                                                                     │
│  │  v1.5: Manual        │ │──invoke▶ Edge Function `tutor` ──┐                                          │
│  │  v2:  Studio Plugin  │ │        │                         ├─▶ OpenAI Responses API (gpt-6-luna)     │
│  └──────────────────────┘ │──invoke▶ Edge Function `end-session` ┘   ※API Keyはここにだけ存在             │
└──────────────────────────┘        └─────────────────────────────────────────────────────────────────────┘
```

* ブラウザは OpenAI を直接呼ばない。`OPENAI_API_KEY` は Edge Function の Secret のみ。
* 書き込みの「信頼が必要なもの」（AIの返答・ヒントレベル・理解チェック正誤・Summary）は**サーバー側だけ**が書く。クライアントには INSERT/UPDATE 権限を与えない。
* 常時稼働サーバーなし。先生画面は 15 秒ポーリング（Realtime は v2 以降で検討）。

### 学習ループと Hint Level の制御

```
生徒の質問 ─▶ tutor関数 ─▶ ヒント上限を計算(ルール) ─▶ AI(上限を守って回答 + 構造化メタ) ─▶ 上限でclamp ─▶ 保存
                  ▲                                                                               │
                  └──── 「もう少しヒント」/ 理解チェックの結果 / つまずき回数 ◀───────────────────────┘
```

* **Hint上限はサーバーのルールで決める**：前回レベル + 1 まで（1ターンに1段階しか上がらない）。新しい問題・解決後はリセット。
* AI は返答と一緒に `hint_level / concept / progress / check(理解チェック)` を Structured Output で返す。
* 理解チェックは **3択** にし、正誤判定は DB 関数で行う（AI の自己申告ではなく実測値として記録）。

## 2. Directory Structure

```
RobloxAITutor/
├─ docs/DESIGN.md                 … このファイル
├─ README.md                      … セットアップ手順
├─ web/                           … フロントエンド (Vite + React + TS)
│  ├─ src/
│  │  ├─ main.tsx / App.tsx       … 認証ゲート + ロール別ルーティング (hash router)
│  │  ├─ lib/                     … supabase client, auth, router, 画像圧縮, Luauハイライト, ミニMarkdown
│  │  ├─ context/                 … ★ RobloxContextSource（v1.5: manualContextSource）
│  │  ├─ features/student/        … AI先生画面 (Composer, CodeEditor, ImageTray, CheckCard…)
│  │  ├─ features/teacher/        … 先生Dashboard + statusRules.ts (ルールベース状態判定)
│  │  ├─ features/parent/         … 保護者Dashboard (スマホ優先)
│  │  └─ dev/Preview.tsx          … 開発時のみ: Supabaseなしで画面確認できるfixtureプレビュー
│  └─ vite.config.ts
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/…_init.sql       … テーブル / RLS / RPC / Storage
│  ├─ seed.sql                    … レッスン初期データ
│  └─ functions/
│     ├─ _shared/
│     │  ├─ contracts.ts          … ★ RobloxContext / API型（Web側からも型importする唯一の定義）
│     │  ├─ openai.ts             … Responses API クライアント（fetch, 構造化出力のパース）
│     │  ├─ tutor/                … prompt.ts / schema.ts / hintPolicy.ts / buildInput.ts
│     │  └─ summary/              … prompt.ts / schema.ts / metrics.ts
│     ├─ tutor/index.ts
│     └─ end-session/index.ts
├─ scripts/create-users.mjs       … 生徒・先生・保護者アカウント一括作成（service role）
└─ .github/workflows/deploy-pages.yml
```

## 3. DB Schema（最小構成）

| table | 主な列 | 備考 |
|---|---|---|
| `profiles` | id(=auth.users.id), role(student/teacher/parent), display_name, teacher_id | 生徒の担当先生は `teacher_id` |
| `student_parent_links` | student_id, parent_id | 保護者⇔子ども |
| `lessons` | id(slug), title, goal, concepts[], sort_order | 例:「触れるとダメージを受ける床」 |
| `lesson_sessions` | student_id, lesson_id, goal_note, status(active/ended), completed, help_requested_at, current_concept, current_problem, started_at, last_activity_at, ended_at | 生徒1人につき active は1つ (partial unique index) |
| `messages` | session_id, student_id, role(student/tutor), message, code, attachments(jsonb: Storage path のみ), intent, hint_level, meta(jsonb), created_at | 画像本体は保存しない |
| `quiz_attempts` | session_id, student_id, message_id, question, choice_index, is_correct, created_at | 理解チェックの回答（実測値） |
| `lesson_summaries` | session_id(unique), student_id, created_today, learned[], struggled_with[], how_student_solved_it, next_lesson, parent_summary, **metrics(jsonb, 実測値)**, model | AI文章と実測値を列で分離 |

`messages.meta`（tutor行）: `{ concept, problem, progress, check: {question, choices[], answer_index, explanation} | null, model }`

## 4. RLS設計

ヘルパー関数（`private` スキーマ, `security definer`）:
`private.my_role()` / `private.is_teacher_of(student)` / `private.is_parent_of(student)` / `private.can_view_student(student)`

| table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| profiles | 本人 / 担当先生 / 紐づく保護者 / 生徒は自分の担当先生 | なし（管理スクリプトのみ） |
| student_parent_links | 本人(生徒・保護者) / 担当先生 | なし |
| lessons | ログイン済み全員 | なし（seed） |
| lesson_sessions | `can_view_student(student_id)` | RPC `start_session` / `set_help_request`、終了は Edge Function |
| messages | `can_view_student(student_id)` | Edge Function `tutor`（service role）のみ |
| quiz_attempts | `can_view_student(student_id)` | RPC `submit_check_answer` のみ（正誤をDBで判定） |
| lesson_summaries | `can_view_student(student_id)` | Edge Function `end-session` のみ |
| storage `screenshots` | フォルダ先頭 = student_id で `can_view_student` | 生徒本人のフォルダにのみ INSERT |

* 画面を隠すだけの制御はしない。先生が他クラスの生徒を、保護者が他人の子を読むことは DB が拒否する。
* 公開サインアップは無効化（ロールの自己申告による権限昇格を防ぐ）。アカウントは `scripts/create-users.mjs` で作成。
* Edge Function は service role を使うが、必ず先に呼び出し元 JWT を検証し「本人の active セッションか」「担当先生か」をコードで確認する。

## 5. AI Tutor API設計

### `POST /functions/v1/tutor`
```ts
// request
{ sessionId: string; context: RobloxContext; intent: "ask" | "more_hint" | "confused" | "solved" }
// response
{ studentMessage: MessageRow; tutorMessage: MessageRow }
```
処理: JWT検証 → セッション所有確認 → レート制限(1分6回) → 画像パス検証(自分のフォルダか) → 生徒メッセージ保存 → 履歴取得(直近20件) → Hint上限計算 → `buildTutorInput(context, history, policy)` → OpenAI → clamp → tutorメッセージ保存 → セッション更新。

### `POST /functions/v1/end-session`
```ts
{ sessionId: string; completed?: boolean; regenerate?: boolean } → { summary: LessonSummaryRow }
```
呼べるのは本人の生徒 or 担当先生。実測値(metrics)はSQL集計、文章はAI（Structured Output）。AI失敗時もセッションは終了し、先生画面から再生成できる。

### RPC（Postgres関数）
`start_session(p_lesson_id, p_goal_note)` / `set_help_request(p_session_id, p_on)` / `submit_check_answer(p_message_id, p_choice)`

## 6. RobloxContext設計

```ts
type RobloxContext = {
  question: string;
  code?: string;                      // v1.5: 生徒が貼り付け
  screenshots?: string[];             // v1.5: Storage path（バイナリは渡さない）
  projectTree?: string;               // v2: Plugin / MCP
  currentScript?: { path?: string; source: string }; // v2
  errors?: string[];                  // v2: Outputのエラー
  source?: "manual" | "studio-plugin" | "mcp";
};
```

* **取得側**（Web）: `RobloxContextSource` インターフェース。v1.5 は `manualContextSource`（入力欄＋アップロード）。v2 は `studioPluginContextSource` を追加するだけ。
* **AI側**（Edge Function）: `buildTutorInput()` は `RobloxContext` だけを見る。各フィールドを「あれば載せる」セクションとして整形するため、v2 で `projectTree` / `errors` が埋まっても Tutor ロジックの変更は不要。
* `screenshots` の解決（Storage → base64）は `resolveScreenshots()` に隔離。

## 7. UI構成

| 画面 | 方針 |
|---|---|
| ログイン | 「ログインID」+「パスワード」。IDに `@` がなければ `@{VITE_LOGIN_DOMAIN}` を補完（子どもがメールを覚えなくてよい） |
| 生徒: レッスン選択 | カードを1つ選んで「はじめる」。何を作るかを一言（任意） |
| 生徒: AI先生 | ダーク基調（Studioと並べて違和感がない）。「どこで困った？」→ 📋コード / 📷Studio画面 → 「AI先生に聞く」。画像はファイル選択 / D&D / Ctrl+V、サムネイル＋削除。返答の下に「💡もう少しヒント」「🤔よくわからない」「✅できた！」。理解チェックは3択カード。🙋先生を呼ぶ。狭い幅(Studioと横並び)で使える1カラム |
| 先生Dashboard | 🔴→🟡→🟢 の順に並ぶカードグリッド。状態の**理由**（例: 同じ理解チェックで2回不正解）を表示。カードクリックで会話・コード・スクショを確認。授業終了ボタン（個別/全員） |
| 保護者Dashboard | スマホ優先の縦並び。「記録（実測値）」と「AIによるまとめ」を見た目で分離し、AI部分にはその旨を明記。数値スコアはAIに作らせない |

### 先生画面の状態判定（ルールベース, `statusRules.ts`）
* 🔴 先生のサポート推奨: 先生を呼んでいる / 同じ理解チェックで2回以上不正解 / 同じ問題で3回つまずき / 10分以上活動なし
* 🟡 少し苦戦中: ヒントLv3以上を使用中 / 同じ問題で2回つまずき / 5分以上活動なし / 直近の理解チェック不正解
* 🟢 順調: 上記に当てはまらない　⚪ 授業外: active セッションなし

## 8. 実装 Milestone

1. **M1 基盤**: Supabase init / migration (schema + RLS + RPC + storage) / seed / ユーザー作成スクリプト
2. **M2 AI Tutor**: contracts(RobloxContext) / OpenAIクライアント / prompt・schema・hintPolicy / `tutor` 関数
3. **M3 生徒UI**: ログイン / レッスン選択 / Composer(コード・画像) / 会話 / 理解チェック / 先生を呼ぶ
4. **M4 先生UI**: 状態判定ルール + Dashboard + 詳細 + 授業終了
5. **M5 Summary + 保護者UI**: `end-session` 関数 / 保護者Dashboard
6. **M6 仕上げ**: 単体テスト(ルール・ヒント上限・Context組み立て) / GitHub Pages デプロイ / README

---

## 追記（2026-10-04）：保護者ページの分離とLINEログイン

* 保護者向けは React アプリから外し、ビルド不要の HTML/JS（`parent/`）として別アプリにした。データは同じ Supabase を RLS 越しに読むだけ。
* ログインは LINE Login v2.1。Supabase に LINE の標準プロバイダーが無いため、Edge Function `line-login` で処理する：
  1. 保護者ページ → LINE 認可画面（`state` / `nonce` を sessionStorage に保存）
  2. LINE → 保護者ページに `code` が返る → `state` を照合
  3. `line-login` 関数：`code` をトークンに交換 → `/oauth2/v2.1/verify` で ID トークン検証（aud = チャネルID、nonce 一致）
  4. `parent_line_accounts` で LINE ユーザー → 保護者プロフィールを引く。未連携なら招待コード（`parent_invites`、1回限り・14日有効）を消費して連携
  5. `auth.admin.generateLink(magiclink)` の token hash を返す → ページが `verifyOtp` で通常の Supabase セッションにする（メールは送らない）
* `parent_line_accounts` / `parent_invites` は RLS 有効・ポリシーなし（service role のみ）。
* 要約の自動送信はしない（保護者がページを開いて見る）。

---

## 追記（2026-10-08）：「動くものが先、理解が後」— 作品モードと習熟度

### 学習の流れ（関所つき）
```
決める → 組み立てる → 予想する → 動かす → しくみ探検 → いじる → 完成
         (穴うめ/自分で書く) (3択)  (Studio)   (解説＋確認・順番固定) (予想＋改造)
```
* 各関所は「正解」または「2回まちがえたら答えを見せて通す（assisted として記録）」で通過。段階は DB が完了状況から決めるので飛ばせない。
* 「自分で書く」は AI が判定（Edge Function `project` の write）。3回目の不合格でお手本を入れて進める。

### 習熟度（生徒×概念、DBに記録）
| レベル | 名前 | 上がる条件（実測） |
|---|---|---|
| 0 | 初見 | — |
| 1 | 一度習った | しくみ探検の確認問題に正解 |
| 2 | 思い出せる | 穴うめをヒントなしで正解 |
| 3 | 自分で書ける | 自分で書いたまとまりが合格 |

* 穴うめで答えを見た → 1 に戻る。30日使っていない 2・3 は 1 扱い（次の作品で穴うめ＝復習）。
* 概念は固定の一覧（`concepts`、約25個）。AI は Structured Output の enum でこの ID しか付けられない。
* 証拠は `concept_events`（いつ・どの作品で・何をして・前後のレベル）に全件残る。先生は `teacher_set_concept_level` で修正可。

### コードの出し分け（`_shared/project/mastery.ts`）
まとまりの中で一番低い習熟度で決める：0→解説（explain）、1→穴うめ（blank）、2→自分で書く（write）、3→そのまま（given）。1作品あたり穴うめ・自分で書くは各2個まで。

### テーブル
`concepts` / `projects` / `project_blocks` / `project_keys`（答え。クライアントは読めない）/ `project_attempts` / `student_concepts` / `concept_events`

### 先生画面の追加ルール
* 🔴 「動かない」と報告して5分以上
* 🟡 関所で答えを見て進んだ2回以上 / 同じステップで15分以上

## 追記（2026-10-09）：作りたいものを「頭の中の解像度」で伝える

文章だけだと、AIの理解が浅いまま作り始めてしまう。そこで、伝える手段を増やし、作る前にAIが聞き返す。

### 伝える手段
- **参考画像（最大3枚）**：手書きの絵の写真・まねしたいゲーム・Studioの画面。`screenshots` バケットに保存し、`projects.idea_images` にパスを記録する。plan / refine / build のたびにAIへ渡す。
- **Explorerの構成（プラグインなし）**：`_shared/studioTree.ts` の `TREE_COMMAND` は、読み取り専用の1行Luau。
  - 手順：生徒がStudioのコマンドバー（［スクリプト］タブ →［コマンドバー］、または Ctrl+9）に貼る → 出力（Output）に出た `=== AI-SENSEI TREE START/END ===` の間をコピーして貼る。
  - 同じ名前のものは `x数` にまとめ、テクスチャ・Weld・UIレイアウト部品は省く。サービスごとに行数の上限がある。
  - 読み込みは `extractTree()` が担当し、タイムスタンプや前後のログは無視する。
  - 結果は `projects.explorer_tree` に保存する。作品中のチャットでは、`RobloxContext.projectTree` に自動で入る。
- チャットの入力欄にも「構成」ボタンがある。これも `RobloxContext.projectTree`（manual source）で送る。v2 のプラグイン / MCP は同じフィールドを自動で埋めるだけでよい。

### 聞き返し →「こういうこと？」
1. `plan`：AIは次の2つを返す。
   - `understanding`：「こういうこと？」の文。生徒の言葉と、実際のパーツ名を使う。
   - `questions`：コードが変わるのに、まだ分からないことだけ。0〜3問の、タップで答える2〜3択。UIが「おまかせ」を足す。
2. 生徒が答える → `refine(answers)`。質問は1回だけで、以後は `questions = []` になる。
3. 「そう！これで作る」→ `build`。「ちょっとちがう」→ `refine(feedback)`（構成をあとから足すこともできる）。作り直しは最大6回まで。
4. `build` には、確認済みの `understanding`・回答・注文・構成・画像が渡る。parent_path や FindFirstChild には、構成にある実際の名前を使わせる。
5. 先生の詳細パネルには「こういうこと？」の文と、生徒が見せたもの（画像の枚数／構成）が出る。

## 追記（2026-10-09）：AI先生のチャットを「普通に答える場所」に／チャットから作品を直す

- **ヒントレベル（0〜4）を廃止**しました。
  - AI先生は、質問や要望にそのまま答えます。コードも見せます。
  - なくしたもの：`hintPolicy.ts`、出力の `hint_level`、チャット内の3択チェック。新しく保存する `messages.hint_level` は null です。
  - 古いデータの表示はそのまま残しています。
  - 作品の関所（穴うめ・自分で書く部分・しくみ探検の確認問題）の答えだけは、学習記録になるので直接は言わず、考え方を説明します。
- **作品づくりの途中での注文**（UIには出さない）：
  1. 作品を作っているあいだに、生徒がチャットで「〇〇に変えたい」と言うと、tutor が `project_request` にその注文を1文で返します。
  2. クライアントがすぐに `project` の `revise` を呼びます。
     - plan 段階のとき：プランを作り直します。
     - コードがあるとき：プランを作り直したあと、`reset_project_for_revision`（service role）を実行します。ブロック・答え・関所の回答を消し、stage を plan に戻します。そのあと、前のコードを渡して build し直します。注文に関係ない部分は、前のコードをそのまま使わせます。
  3. 習熟度（student_concepts / concept_events）は残ります。作り直したコードは、今の習熟度で出し分けられます。
  4. build に失敗したときは、新しいプランの「こういうこと？」で止まります。
  5. 作り直し中は、作品の画面に「作り直し中」と表示され、チャットの送信は止まります。完成した作品は変えません。
- 作り直しの回数は、プランの回数と合わせて最大12回までです。
- 保護者ページの「ヒント使用」は、0回のときは表示しません。生徒の完了画面では「ヒント」の代わりに「完成した作品」を表示します。

## 追記（2026-10-10）：体験授業（再現性を上げる）

- **レッスンは「体験授業」だけにしました。**
  - 前のレッスンは `is_active = false` にして画面から隠しています。過去の授業の表示のために、行そのものは残しています。
  - `lessons.ai_guide`（このレッスンのときだけ AI に足す決まり）と `lessons.max_lines` を追加しました。
- **体験授業を選ぶと、AI先生（plan / build / チャット）に体験授業用の決まりが付きます。**
  - 決まりは指示のいちばん最後に置き、ほかの指示より優先させています。
  - 中身：今ある Script に差し込む3〜10行のコード、使ってよい部品の一覧、コメントは1か所だけ。お手本（たまに爆発するキー）も入れています。
  - build のコードが `max_lines` を超えたら、「長すぎる」と伝えて1回だけ作り直させ、短いほうを使います。
- **今ある Script に差し込むとき**
  - plan が `script_request`（見たい Script の名前と理由）を返したら、生徒は Studio で Ctrl+A → Ctrl+C でコピーして貼ります。「ない」と答えることもできます。
  - 貼った中身は `projects.scripts` に入り、plan・build・チャットの入力に使われます。
  - build は、その Script に差し込むコードと「どの行の下に貼るか」を出します。
  - チャットで頼まれた変更（revise）でも Script が必要になったときは、plan に戻って同じように貼ってもらいます。
- **しくみ探検は「1行ずつ翻訳 → 最後にランダムで1問」に変えました。**
  - build が各行の `lines` を作ります。中身は、その行の日本語訳（meaning）と、つまずきやすい言葉の意味（words、1行に3つまで）です。
  - 訳を付けるのは explain / given のまとまりだけです。穴うめや「自分で書く」部分に付けると答えが分かってしまうので付けません。
  - 確認問題は、explain のまとまりの問題からサーバーがランダムに1つ選びます（`projects.quiz`、答えは keys の `'quiz'`）。
  - 正解（または2回まちがえて答えを見た場合）で、すべての explain のまとまりの探検が終わったことになり、習熟度に記録されます。
  - `quiz` がない古い作品は、これまでどおり、まとまりごとに1問ずつ出します。
- **画面で消したもの**
  - 作りたいものの例のカード
  - 「困ったことを聞くなら、たとえば…」
  - 入力欄の「例：」の文

## 追記（2026-10-11）：前に使った構成をえらぶ／完成したら最初の画面へ
- **前に使った Studio の構成を保存して、カードから選び直せるようにしました。**
  - 保存先は `student_trees` です（本人だけが読めます）。書き込みは `save_tree()` からだけで、同じ構成は1つにまとめ、最新12件まで残します。
  - 今までの作品の `explorer_tree` も最初に取り込みました。
  - コマンドが場所の名前（`PLACE: game.Name`）も出すようにしたので、カードに「キーボードタワー」のように名前が出ます。
  - カードには、パーツとスクリプトの数と、最後に使った日も出します。
  - 新しく入れるときは、これまでどおり3ステップです。
- **作品が完成したとき・作品をやめたときは、最初の画面（今日はなにする？）に戻ります。**
  - チャットの履歴は「これまでのAI先生との会話を見る」から開けます。質問を送ったときも自動で開きます。
  - チャット画面からは「作りたいものから始める」で最初の画面に戻れます。

## 追記（2026-10-12）：入力欄のずれ／習熟度リセット／完成後は最初の画面へ
- **コード入力欄のカーソルのずれを直しました。**
  - 原因：色付きの層（`<pre><code>`）だけがブラウザ標準の等幅フォントになっていて、文字の幅が入力の層とちがっていました。そのため、文字を打つほどカーソルが文字からずれていきました。
  - 直し方：両方の層を同じフォント（JetBrains Mono）にそろえ、`palt`、合字、カーニング、字間もそろえました。
- **先生が、生徒の習熟度をまとめてリセットできるようにしました**（詳細パネルの「習熟度をリセット」）。
  - 使っているのは `teacher_reset_mastery()` です。習熟度はすべて「初見」に戻ります。
  - 履歴は `concept_events` に、`teacher_set` の記録（`detail.reset = true`）として残します。
- **作品が完成したら、そのまま最初の画面に戻ります。**
  - 最初の画面の上に「完成おめでとう」と「できるようになったこと」のカードを出します。
  - これまでは完成画面に残っていて、PCでは右側にチャットが開いたままでした。

## 追記（2026-10-13）：授業のあとは最初の画面へ／構成の削除
- **授業を「おわる」→ 結果の画面 →「新しいレッスンをはじめる」と進んだときに、前の授業の作りかけの作品が自動で開いてしまう問題を直しました。**
  - 自動で開くのは、同じ授業の作品だけにしました（ページを読みこみ直したとき）。
  - 前の授業の作品は、最初の画面に「作りかけの作品があるよ」のカードとして出します。カードには「つづきから作る」「やめる」があります。
  - 「つづきから作る」を押すと、`resume_project()` で作品を今日の授業に移します。こうすると先生の画面にも出ます。
  - 作りかけの作品があるまま新しく作ろうとしたときは、「作りかけをやめて新しく作る？」と確認します。開いておける作品は1人1つだけだからです。
- **前に使った構成のカードに「×」（消す）ボタンを付けました。** 消せるのは自分の構成だけです（RLS の delete ポリシー）。

## 追記（2026-10-14）：手で打ちこむ／テスト3問／記述式のいじる（予想はなし）
流れは「決める → 打ちこむ → 動かす → テスト → いじる → 完成」です。

- **打ちこむ**
  - AI先生のコードは、コピーさせずに1行ずつ手で打ちこみます。お手本の行は選択・コピー・右クリックができず、入力欄には貼りつけもできません。
  - 打ちこむ行の上には、その行の日本語訳と、言葉の意味のラベルを出します。
  - 判定は `typing.ts` で行います。字下げ・記号まわりのスペース・コメント・全角英数字は気にしませんが、名前や大文字・小文字は厳しく見ます。
  - 合っていれば自動で次の行へ進みます。ちがうときは「〇〇までは合ってるよ」と、どこまで合っているかを出します。
  - まとまりは上から順番に進めます。穴うめは、正解したあとにその行も打ちこみます。自分で書く部分は、これまでどおり AI がチェックします。
  - まとまりを全部打ち終えたら `mark_block_typed()` を呼び、そのまとまりを完了（build_done）にします。`start_project_build()` は、もう自動で完了にしません。
- **動かす**：Studio に貼るときだけ「打ちこんだコードをコピー」できます。
- **予想する**は外しました。新しい作品には predict のキーがないので、このステップは飛ばされます。古い作品はこれまでどおりです。
- **テスト**
  - 3択の問題を3問、順番に出します（`quiz:0`〜`quiz:2`）。問題は build の AI が作り、足りないときは各まとまりの確認問題で補います（`pickQuiz`）。
  - 3問目まで終わると、AI先生が説明した部分（explain のまとまり）の習熟度を記録します。途中で答えを見た問題があれば「assisted」として記録します。
- **いじる**
  - ミッションのあと、「やってみてどうなった？」に文章で答えます。
  - AI先生が期待する答えと比べて判定し（`project` の `tweak` アクション）、結果は `record_tweak_answer()`（service role）で記録します。
  - 2回まちがえたら、こうなるはずだった、という答えを見せて完成できるようにします。
- **見た目**：コードは合字を切ってあります。`==` が1つの記号に見えないようにするためです。

## 追記（2026-10-15）：打ちこみ中の解説／コードのテスト／自分で書く→チャット
流れは「決める → 打ちこむ → 動かす → テスト → 完成」です。いじるは新しい作品にはありません。

- **打ちこむ**
  - 打ち終わった行も、そのまま解説を残します（コード → 日本語訳 → 言葉の意味ラベル）。まとまりの最初には、まとまり全体の説明を出します。
  - 穴うめのまとまりにも訳を付けました。答えになる言葉はサーバー側で「？」に隠し（`maskLines`）、言葉の意味ラベルからも外します。
- **テスト**：「こうしたい！どう変える？」の問題を3問出します。この作品のコードの1〜4行を書きかえる問題です。
  - 判定は、まずお手本と同じかどうかを見ます（`codeMatch.ts` の `sameCode`。打ちこみと同じゆるさで比べます）。ちがうときは AI先生が判定します。別の書き方でも、やりたいことができていれば正解です。
  - 2回まちがえたら、お手本を見せて先に進めます。結果は `record_quiz_answer()`（service role）で記録します。
  - いじる（tweak）のキーがない作品は、テストのあとそのまま完成になります（`refresh_project_stage`）。
- **自分で書く**：「ここまでをAI先生に聞く」ボタンで、書いたところまでのコードと質問の文を右のチャット欄に入れます（送信は生徒が押します）。
- 進み具合のバーには、その作品にあるステップだけを出します（予想する・いじるは古い作品のときだけ）。

## 追記（2026-10-16）：保護者ページを今の授業に合わせる／授業の中身から AI がまとめる
- **授業を終わらせたときの AI のまとめ（end-session）に、作品づくりの記録も入れるようにしました。** これまでは AI先生とのチャットしか渡していませんでした。
  - 渡す中身（`projectWorkLines`）：作品名と、完成したかどうか、説明を読みながら打ちこんだ部分と行数、自分で書いた部分の結果、コードのテスト1問ごとの結果（1回目で正解・何回目で正解・お手本を見た）。
  - 先生画面の「授業を終了」「全員の授業を終了」でも、生徒の「おわる」でも、同じ処理でまとめを作ります。
- **実測値に、作品づくりの数字を足しました**（`projectMetrics`）。
  - 足したもの：`tests_total / tests_first_try / tests_solved`（コードのテスト）、`typed_lines`（手で打ちこんだ行数）、`written_by_self`（自分で書けた部分）、`works`（作品ごとの今のコード）。
- **保護者ページ**
  - 「理解チェック」の代わりに「コードのテスト（〇/3問 正解）」を出します。古い記録は、これまでどおり理解チェックを出します。
  - 「手で打ちこんだコード」「自分で書けたところ」の数字を出すようにしました。
  - 「今日書いたコード」は、開くと見られるようにしました。
  - 絵文字をやめて、生徒アプリと同じ線の SVG アイコンにしました。
  - MJ のロゴを parent/brand に入れたので、ローカルでもロゴとファビコンが出ます。
  - サンプルデータ（?demo=1）を、体験授業と今の流れに合わせて作り直しました。
- **先生が授業を終わらせたときの生徒の画面**：生徒の画面は15秒ごとに授業の状態を確かめます。先生が終わらせていたら、結果の画面（まとめ）に切り替わります。
