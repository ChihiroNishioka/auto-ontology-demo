# 設計書：記事から自動で組み立てるオントロジー体験デモ

状態：設計のみ（コードはまだ無い）。実装担当はこの文書と `AGENTS.md` に従う。

---

## 1. ねらい

- 手元に保存している AI 関連記事（Notion の Articles データベースを書き出した JSON）から、**概念（用語）と概念どうしの関係**を自動で組み立てる。
- できたオントロジーを **辿る**（グラフ）・**調べる**（概念の詳細と出典記事）・**質問する**（関係の経路と根拠の記事が返る）ことで、「オントロジーがあると何がうれしいか」を体感できるようにする。
- NVIDIA/auto-ontology の考え方（下書きを自動生成 → 人が確認 → 根拠つきで答える）を、**DB もモデルも API キーも無しで 1 コマンドで動く**大きさに縮める。
- 同じ入力からは毎回同じオントロジーができる（決定的・再現可能）。

やらないこと：SQL 生成、認証、複数ユーザー、Notion との直接連携、クラウド公開。

---

## 2. 元にしたもの：NVIDIA/auto-ontology の要点

保存記事（Notion のページ）は本文が空で、タイトルと URL（github.com/NVIDIA/auto-ontology）だけだった。そのため内容はリポジトリの clone（README、`auto_ontology/semantic`、`auto_ontology/retrieval/entity_coverage`、`docs/mcp.md`）から読み取った。

| 項目 | auto-ontology の中身 |
| --- | --- |
| 目的 | エージェントが企業データに答える前に「データがどこにあり、何を意味し、どう使うか、出どころは何か」を教える文脈の層を作る |
| オントロジーの部品 | **Term**（業務概念。説明と同義語つき、列に対応）、**SQL attribute**（確認済みの計算式）、**Relationship**（表の結合。キーとデータから推定） |
| 3 段階 | **Generate**（スキーマ読取 → 表ごとに用語抽出 → 関係を解決 → Postgres+pgvector に書く）／**Certify**（人が質問で試し、名前・説明を直して確認済みにする）／**Answer**（意図分類・実体抽出 → 埋め込み検索で候補 → SQL → 検証 → 答えと SQL と手順を返す） |
| 答えられるかの判定 | `check_answerable`：質問の実体が用語でどれだけ覆えるか（coverage 0〜1）。覆えなければ「このデータでは答えられない」と返す |
| 根拠 | すべての答えに SQL と「どの用語を使い、どう結合したか」の手順（provenance）がつく |
| 決定的な部分 | 表名から用語名を作る処理、外部キー列の除外などは規則で行い、LLM は説明文や用語提案に使う |
| 提供方法 | Web UI（グラフで用語を選ぶと説明・関連用語が出る）、MCP、CLI、REST |
| 構成 | Next.js + FastAPI + LangChain + Postgres/pgvector + NVIDIA NIM（API キー必須）、Docker Compose / Helm |

### 2.1 どこを真似し、どこを簡単にしたか

| auto-ontology | このデモ | 判断 |
| --- | --- | --- |
| 入力はデータベースのスキーマと値 | 入力は**記事の文章**（タイトル・Summary・Key Takeaways・Knowledge Delta） | 対象を差し替え |
| Term（説明・同義語） | **概念**（表示名・種類・同義語・説明・出典記事） | 真似る |
| 人が Certify した用語 | リポジトリ内の**用語集 `ontology/glossary.ja.json` に載った概念＝「確認済み」**、記事から自動で拾った概念＝「自動抽出（下書き）」と UI で区別 | 簡単化：確認作業は用語集ファイルを編集すること |
| Relationship（キー・データから推定） | **同じ文に一緒に出る（共起）**＋**手がかり語の規則**（「〜と比較」「〜を使う」など）＋**用語集に書いた上下・提供元の関係** | 簡単化：推定はすべて規則 |
| LLM で用語・説明を作る | 使わない。説明は用語集の文か、その概念を含む最初の根拠文 | 決定的にするため |
| 埋め込み検索で候補を探す | 表記ゆれを吸収した**文字列の最長一致**（同義語辞書つき） | 簡単化 |
| `check_answerable` の coverage | 質問の語のうち概念に当たった割合を**カバー率**として出し、低ければ「答えられない」と正直に返す | 真似る |
| 答え＋SQL＋手順 | 答え＋**関係の経路**＋**経路の各辺の根拠文と出典記事** | 真似る（SQL の代わりに経路） |
| Learn（訂正を取り込む） | 対象外。用語集を直して再起動すると反映される、で代替 | 省略 |
| Postgres / pgvector / Docker / NIM | **メモリ上のグラフ＋ JSON キャッシュ**。外部サービス無し | 簡単化 |
| 自然文の答え | 既定は**テンプレート文**。任意で手元の `claude` CLI に要約させられる（無くても全機能が動く） | 任意機能 |

---

## 3. 入力データ

### 3.1 Articles データ（`ARTICLES_PATH` で指定するローカルファイル）

調査したファイルの形（値は載せない）：`{"results": [...], "has_more": true}`、**100 件**（`has_more` が true なので先頭ページのみ。アプリは件数を決め打ちしない）。

| 欄 | 入っている件数 | 使い方 |
| --- | --- | --- |
| `Title` | 100 | 表示・概念抽出 |
| `userDefined:URL` | 100 | 記事の外部 URL（表示用リンク） |
| `Canonical URL` | 90 | あれば `userDefined:URL` より優先 |
| `Summary` | 96（平均 約290 字、ほぼ日本語） | 概念・関係抽出の主材料 |
| `Key Takeaways` | 96（`<br />` 区切り、先頭が `・`） | 箇条ごとに 1 文として抽出に使う |
| `Knowledge Delta` | 96（`Extend:` などの接頭辞つき 1 文） | 接頭辞を外して抽出に使う |
| `Content Type` | 97（GitHub Repo 46 / Web Article 30 / X Post 16 / Other 4 / PDF 1） | 絞り込みと表示 |
| `Source` | 100（markdown リンク形式が混在） | 表示（リンク記法を外す） |
| `date:Captured At:start` / `date:Published At:start` | 95 / 48 | 表示・並び順 |
| `AI Score` ほか採点（Novelty, Credibility, Practicality, Timeliness, Strategic Relevance） | 96 | 出典記事の並び順（AI Score 降順） |
| `Processing Status` | 100（Processed 95 / Inbox 3 / Needs Review 2） | `Processed` 以外も読むが、Summary が空なら抽出対象外 |
| `Related Articles` | 74（Notion ページ URL の配列） | 読み込み時に**内部 ID に置き換え**、記事どうしの「関連記事」として使う。元の URL は捨てる |
| `Concepts` / `Research Themes` / `Claims` | 92 / 56 / 79（Notion ページ URL の配列のみ） | **使わない**。名前が入っておらず、Notion の内部 ID しか無いため |
| `url`（Notion ページ URL）、`Processing Note`、`Content Fingerprint`、`Retry Count` | — | **使わない・読み込み時に捨てる**（内部 ID や作業ログを含む） |

受け付ける形：`{"results":[...]}` か、記事オブジェクトの配列。欄が欠けていても落ちない（空として扱う）。

### 3.2 `article-auto-ontology.txt`

Notion ページの取得結果。本文は空で、内容は上の Articles 行と重複するため**アプリの入力にはしない**（設計の参考のみ）。

### 3.3 リポジトリに入れるデータ

- `fixtures/articles.sample.json`：**架空の記事 10 件前後**（タイトル・`https://example.com/...` の URL・要約・Key Takeaways・Content Type だけ）。用語集の概念が複数記事にまたがり、経路が 2〜3 段になる組み合わせを含める。
- `fixtures/articles.empty.json`（0 件）、`fixtures/articles.broken.json`（壊れた JSON）。
- 本物の Notion データ、Notion の URL・ID はリポジトリに一切入れない。

---

## 4. データの流れ

```
ARTICLES_PATH（ローカル JSON。未設定ならサンプル fixture）
   │ 1. 読み込み・正規化（loader）   … 不要欄と Notion URL を捨てる
   ▼
Article[]（id, title, url, sourceLabel, contentType, capturedAt, score, sentences[], relatedIds[]）
   │ 2. 概念抽出（extract）          … 用語集の最長一致 ＋ 候補語の規則抽出
   │ 3. 関係抽出（relate）           … 共起・手がかり語・用語集の関係
   ▼
Ontology（concepts[], relations[], articles[], meta{inputHash, builtAt, counts}）
   │ 4. キャッシュ  .cache/ontology-<inputHash>.json（git 管理外）
   ▼
API サーバー（メモリに保持）── 5. 経路探索・カバー率（ask）── 任意：claude CLI で要約
   ▼
ブラウザ（SPA：グラフ／概念／質問）
```

- 起動時に 1 回だけ組み立てる。入力ファイルの内容ハッシュが同じならキャッシュを使う。
- `npm run build:ontology` で、サーバー無しに組み立てて件数と上位概念を標準出力に出せる（確認用。記事本文は出さない）。

---

## 5. オントロジーの作り方（決定的）

乱数・時刻・外部サービスに依存しない純粋関数 `buildOntology(articles, glossary, stopwords, options) -> Ontology` にする。並びはすべて安定キー（重み降順 → 表示名の昇順 → id）で決める。`builtAt` だけは結果比較から除く。

### 5.1 正規化と文分割

1. 文字は NFKC 正規化。`<br />` を区切りに、markdown リンク `[a](b)` は `a` に、`\$` などのエスケープを戻す。
2. 文の単位：Title（1 文）、Summary を `。` `．` `!` `?` で分割、Key Takeaways を `<br />`・改行で分割して先頭の `・` を外す、Knowledge Delta の `Extend:` 等の接頭辞を外して 1 文。
3. 文には `articleId` と文番号を付け、根拠（evidence）として後で表示する。
4. 記事 ID：表示用 URL を正規化（末尾 `/`、`?utm_*` 除去）した文字列の SHA-1 先頭 10 桁。URL が無ければタイトルで同様に作る。

### 5.2 概念抽出（Generate：Name entities に相当）

**(a) 用語集（確認済み）** — `ontology/glossary.ja.json`（リポジトリに入れる。一般的な AI 用語だけで個人情報を含まない）

```json
{ "id": "claude-code", "label": "Claude Code", "type": "product",
  "synonyms": ["claude code", "ClaudeCode"], "description": "Anthropic のコーディングエージェント",
  "relations": [{ "type": "is_a", "target": "coding-agent" }, { "type": "made_by", "target": "anthropic" }] }
```

- 種類（type）：`product`（製品・ツール）／`technique`（手法：RAG、MCP など）／`org`（組織）／`idea`（考え方：オントロジー、評価 など）。
- 照合：表示名と同義語をまとめて**最長一致・左から**で文を走査。英数字は大文字小文字を無視し、前後が英数字でないこと（語境界）を条件にする。重なった場合は長い方を採る。
- 最初は 60〜100 語程度。記事に多い語（エージェント、Claude、Codex、MCP、RAG、オントロジー、ナレッジグラフ、スキル、プラグイン など）を中心に作る。

**(b) 自動抽出（下書き）** — 用語集で覆われていない部分から次の規則で候補を拾う。

- 英字で始まる製品風の語：`[A-Z][A-Za-z0-9.+\-]*` と、それが空白でつながった 2〜3 語（例 `GitHub Copilot`）。`AGENTS.md` のような `*.md` も可。
- カタカナ 3 文字以上の連なり（`・` でつながる複合語を含む）。
- 「」『』で囲まれた 2〜20 文字。
- 除外：`ontology/stopwords.ja.json`（「データ」「コスト」「ページ」「ユーザー」「Code」「Pro」「MIT」「Apache-2.0」など一般語・ライセンス名・断片）、数字だけの語、1 文字。
- 残す条件：**2 記事以上**に出る（`MIN_DF=2`）。上限 `MAX_CONCEPTS=300`（出現記事数の降順で切る）。
- 概念 ID：用語集の id、自動抽出は `auto-` ＋正規化した表示名の SHA-1 先頭 8 桁。

### 5.3 関係抽出（Generate：Resolve relationships に相当）

| 関係 | 表示名 | 作り方 | 状態 |
| --- | --- | --- | --- |
| `is_a` | 〜の一種 | 用語集の `relations` | 確認済み |
| `made_by` | 提供元 | 用語集の `relations` | 確認済み |
| `compared_with` | 比較される | 同じ文で A と B が「対」「vs」「と比較」「より」の手がかり語をはさむ | 自動 |
| `uses` | 使う・組み込む | 同じ文で「A で B」「A に B を統合/組み込み/適用」「A を使った B」 | 自動 |
| `related_to` | 一緒に語られる | 同じ文に 2 つの概念が出る（共起） | 自動 |

- 手がかり語の規則は `server/ontology/patterns.ts` の表 1 つにまとめ、各規則に単体テストを付ける。規則に当たった組は `related_to` ではなくその型で記録。
- 重み＝その関係を支える**異なる記事の数**。根拠は「記事 ID＋文番号」のリスト（1 辺あたり最大 5 件保持、記事の AI Score 降順）。
- 共起だけの辺は、各概念につき重み上位 `MAX_RELATED=15` 本まで残す（グラフが毛玉にならないように）。
- 記事→概念の `mentions` は辺としてではなく、概念ごとの出典記事リストとして持つ。
- `Related Articles` は記事どうしの「関連記事」として概念詳細画面で出すだけ（概念の関係には混ぜない）。

### 5.4 質問への答え方（Answer に相当）

1. **実体抽出**：質問文に 5.2 と同じ照合（用語集＋自動抽出概念の表示名・同義語）をかける。
2. **カバー率**：質問から 5.2(b) の規則で拾える「内容語」のうち概念に当たった割合。`当たった数 / (当たった数 + 当たらなかった数)`。
   - 1 個以上当たり、かつカバー率 0.5 以上 → 「答えられます」
   - 1 個以上当たるが 0.5 未満 → 「一部だけ答えられます」（当たらなかった語を表示）
   - 0 個 → 「この記事集からは答えられません」＋近い概念の候補（前方一致・部分一致で最大 5 件）
3. **経路探索**：概念が 2 つ以上なら、出現順に隣どうしの組で最短経路を探す（ダイクストラ。辺のコスト＝`1 / (1 + 重み)`、確認済みの辺は ×0.8、最大 4 段）。中継概念が異なる経路を最大 3 本返す（1 本目の中継概念を除いて再探索）。経路が無ければ「つながりが見つかりません」と、両方に共通する記事があればそれを返す。
4. **概念が 1 つ**：その概念の説明、重みの大きい隣接概念 5 件、出典記事を返す。
5. **根拠**：経路の各辺について根拠文と記事（タイトル・URL・種類）を返す。加えて、当たった概念を**すべて**含む記事を「共通の記事」として上位 5 件。
6. **答えの文**：テンプレートで作る（例「Claude Code と オントロジー は、MCP を介してつながっています（根拠の記事 4 件）。」）。
7. **任意：claude CLI 要約**：`ASK_WITH_CLAUDE=1` かつ `claude` コマンドがあるときだけ、経路と根拠文**だけ**を渡して `claude -p` で 3 文の要約を作る（60 秒 timeout、失敗時はテンプレートのみ＋「AI 要約は使えませんでした」）。画面では「AI 要約（下書き）」と明示。既定は無効。テスト・CI では使わない。手元の記事文が Anthropic に送られることを README と画面の注記に書く。

---

## 6. 画面

共通：上部に「グラフ」「質問」のタブ（概念詳細はグラフ・質問から開く）。下部にデータ源の表示（「サンプルデータ（架空の記事 10 件）」または「ローカルファイル：記事 100 件／概念 N 件／関係 M 件」。**ファイルのパスは表示しない**）。サンプル使用時は上部に帯で知らせる。ルーティングは URL で共有・再読み込みできる形（`/`, `/concept/:id`, `/ask?q=`）。

### 6.1 グラフを辿る画面 `/`（`/?focus=<id>`）

- 上：概念の検索欄（同義語でも当たる、候補をドロップダウン表示）、種類（製品／手法／組織／考え方）と「確認済みのみ」の絞り込み。
- 中央：**中心の概念とその隣接概念（最大 12）を放射状に置いた SVG**。配置は並び順から角度を決める決定的レイアウト（物理シミュレーションは使わない）。辺の太さ＝重み、線の種類で関係型、確認済みは実線・自動は破線。隣の概念をタップすると中心が移る。
- 下：**辿った経路**のパンくず（戻れる）と、隣接概念の**リスト表示**（関係の名前・根拠記事数。SVG の代替でありスクリーンリーダー・小画面用）。
- 「詳細を見る」で概念詳細へ、「この概念について質問」で質問画面へ。
- 初期の中心：出典記事数が最大の概念。

### 6.2 概念の詳細 `/concept/:id`

- 表示名、種類、状態バッジ（確認済み／自動抽出）、同義語、説明（用語集の説明、無ければ最初の根拠文）。
- **関係**：型ごとにまとめた相手概念の一覧（重み・根拠件数。タップで相手の詳細へ）。各行を開くと根拠文と記事。
- **出典記事**：AI Score 降順。タイトル（外部 URL を新しいタブで開く）、出典名、種類、取得日、その概念を含む文（該当語を強調）。
- **関連記事**（`Related Articles` 由来）は記事カードの中に小さく。

### 6.3 質問 `/ask`

- 入力欄＋「質問する」ボタン。下に**質問の例**（データから決定的に作る：経路が 2 段ある概念の組を 3 つ）。
- 結果：
  1. 判定（答えられます／一部だけ／答えられません）とカバー率、当たった概念のチップと当たらなかった語。
  2. **関係の経路**：`A ─使う→ B ─一緒に語られる→ C` のように縦に積むカード（390px でも横にはみ出さない）。辺ごとに「根拠 3 件」を開ける。
  3. 答えの文（テンプレート）。AI 要約が有効ならその下に区別して表示。
  4. 共通の記事。
- 質問は URL の `?q=` に入れ、再読み込みで同じ結果が出る。

### 6.4 状態の出し方（全画面共通）

| 状態 | 表示 |
| --- | --- |
| 読み込み中 | 骨組み（スケルトン）＋「読み込み中…」（`role="status"`）。ボタンは二重送信できないよう無効化 |
| エラー（API 5xx・通信失敗） | 「データを読み込めませんでした」＋「もう一度試す」ボタン。技術的な詳細は折りたたみ |
| 0 件 | 記事 0 件：「記事がありません。ARTICLES_PATH のファイルを確認してください」。検索・質問で 0 件：「見つかりませんでした」＋候補 |
| データファイルが無い・壊れている | 専用の案内画面：「記事データが見つかりません（または読めません）。環境変数 ARTICLES_PATH に JSON ファイルを指定して再起動してください」＋起動コマンド例。サーバーは落とさず、`/api/health` は `503` と理由コードを返す |
| 存在しない概念 ID | 「その概念は見つかりません」＋グラフへ戻るリンク（HTTP 404） |

### 6.5 レイアウト

- PC（1280px）：グラフ画面は左に SVG、右に隣接リスト。詳細・質問は最大幅 960px の 1 列。
- iPhone（390px）：すべて 1 列。SVG は幅いっぱいの正方形、ラベルは 8 文字で省略（全文は title とリストで見える）。タップ領域は 44px 以上。横スクロールを出さない。入力欄は 16px 以上（iOS の自動拡大を防ぐ）。
- 日本語 UI。文言は `client/i18n/ja.ts` に集める。

---

## 7. API

すべて JSON。エラーは `{"error":{"code":"...","message":"日本語の説明"}}`。

| メソッドとパス | 内容 | 主な応答 |
| --- | --- | --- |
| `GET /api/health` | 状態 | `200 {status:"ok", dataSource:"file"\|"sample", counts:{articles,concepts,relations}, inputHash}`／`503 DATA_NOT_FOUND`・`DATA_INVALID` |
| `GET /api/concepts?q=&type=&certified=&limit=` | 概念の一覧・検索 | `200 {items:[{id,label,type,status,articleCount,degree}]}` |
| `GET /api/concepts/:id` | 概念の詳細 | `200 {concept, relations:[...], articles:[...]}`／`404 NOT_FOUND` |
| `GET /api/graph?focus=&limit=12` | 中心と隣接の部分グラフ | `200 {center, nodes, edges}` |
| `POST /api/ask` `{question}` | 質問 | `200 {verdict, coverage, matched, unmatched, suggestions, paths, sharedArticles, answer, aiSummary?}`／`400 BAD_REQUEST`（空・500 文字超） |
| `GET /api/examples` | 質問の例 | `200 {items:[string]}` |

- 応答に Notion の URL・ID、ローカルのファイルパス、`Processing Note` は含めない（テストで確認）。
- サーバーは既定で `127.0.0.1` にだけ待ち受ける。iPhone 実機で見るときだけ `HOST=0.0.0.0` を自分で指定する（README に「家の中のネットワークだけで」と注意書き）。

---

## 8. 技術構成

| 層 | 選択 | 理由 |
| --- | --- | --- |
| 実行環境 | Node.js 24（`.nvmrc` と `engines` で固定） | この機械に既にある。Python 側の依存が不要 |
| 言語 | TypeScript（strict） | 型でデータの形を固定 |
| サーバー | Fastify（`inject` で API テストが書ける）＋ `tsx` で実行 | 軽い |
| 画面 | Vite ＋ React 19、CSS は素の CSS（CSS 変数） | グラフは自前 SVG。グラフ用ライブラリは入れない |
| 保存 | 無し（メモリ＋ `.cache/` の JSON） | DB 不要 |
| 単体・API テスト | Vitest | |
| e2e | Playwright（Chromium。手元では WebKit も任意） | この機械に導入済み |
| AI（任意） | 手元の `claude` CLI を子プロセスで呼ぶ | API キーを扱わない |

### 8.1 ディレクトリ

```
app/                         （リポジトリのルート）
  AGENTS.md  CLAUDE.md  LESSONS.md  README.md
  docs/DESIGN.md
  ontology/glossary.ja.json  ontology/stopwords.ja.json
  fixtures/articles.sample.json  articles.empty.json  articles.broken.json
  server/
    index.ts                 起動（環境変数を読む）
    app.ts                   Fastify の組み立て（テストから使う）
    data/loader.ts           読み込み・正規化・不要欄の除去
    ontology/normalize.ts  extract.ts  patterns.ts  relate.ts  build.ts  cache.ts
    ask/match.ts  coverage.ts  paths.ts  answer.ts  claude.ts（任意）
  client/                    Vite + React（pages/Graph, Concept, Ask、components、i18n/ja.ts）
  scripts/start.mjs          ビルドして起動
  scripts/build-ontology.ts  組み立てだけ行う CLI
  scripts/check-secrets.mjs  秘密・個人情報チェック
  tests/unit  tests/api  e2e/
  .github/workflows/ci.yml
```

### 8.2 起動（1 コマンド）

```bash
npm install            # 初回のみ
ARTICLES_PATH=/path/to/articles-rows.json npm start   # → http://127.0.0.1:5178
npm start              # ARTICLES_PATH 未設定ならサンプル fixture で起動
```

`npm start` は画面をビルドしてからサーバーを起動する。開発時は `npm run dev`（Vite とサーバーを同時に起動）。

### 8.3 環境変数

| 名前 | 既定 | 意味 |
| --- | --- | --- |
| `ARTICLES_PATH` | 未設定＝サンプル | 記事 JSON のパス。設定したのに無い・読めない場合はサンプルに**戻さず**エラー案内を出す |
| `PORT` / `HOST` | `5178` / `127.0.0.1` | 待ち受け |
| `ONTOLOGY_CACHE_DIR` | `.cache` | キャッシュ置き場（git 管理外） |
| `MIN_DF` / `MAX_CONCEPTS` / `MAX_RELATED` | `2` / `300` / `15` | 抽出のつまみ |
| `ASK_WITH_CLAUDE` | `0` | `1` で claude CLI 要約を有効化（任意） |

---

## 9. テスト方針

- **単体（Vitest）**：正規化と文分割、記事 ID、用語集の最長一致（同義語・大文字小文字・語境界・重なり）、候補語の抽出と除外、手がかり語の各規則、共起の重みと上限、`buildOntology` の**決定性**（同じ入力で 2 回組み立てて `builtAt` 以外が完全一致、記事の順番を入れ替えても一致）、fixture のスナップショット、カバー率と判定、経路探索（直接・2 段・無し・最大段数）、テンプレート文、loader（`{results}` 形・配列形・欄の欠け・壊れた JSON・0 件）、loader の出力に Notion URL・`Processing Note` が残らないこと。
- **API（Vitest ＋ `fastify.inject`）**：全エンドポイントの正常系、`400`・`404`、データファイル無し（`503 DATA_NOT_FOUND`）、壊れた JSON（`503 DATA_INVALID`）、0 件（`200` で空）、応答全体に Notion のドメイン名・コレクション参照・32 桁の 16 進 ID・ローカルパスが含まれないこと。
- **e2e（Playwright）**：プロジェクトは `desktop`（1280×800）と `iphone-390`（390×844、`isMobile`、`hasTouch`）の 2 つ。サーバーは fixture で起動。読み込み中は `page.route` で応答を遅らせ、エラーは `500` を返させ、データファイル無しは `ARTICLES_PATH` に存在しないパスを渡した別サーバー（別ポート）で確認。各画面で `scrollWidth <= innerWidth`（横はみ出し無し）と主要ボタンの高さ 44px 以上を確認。スクリーンショットは `test-results/`（git 管理外）に出す。
- **秘密・個人情報チェック**：`scripts/check-secrets.mjs` が `git ls-files` の全ファイルを走査し、次があれば失敗：Notion のドメイン名（.so / .com）、Notion のコレクション参照（collection スキームの URL）、ハイフン無し 32 桁の 16 進、メールアドレス（`example.com`・`noreply@` は許可）、電話番号らしき並び、`sk-`・`nvapi-`・`ghp_`・`github_pat_`・`AKIA`・`xox[bp]-`・`-----BEGIN` で始まる値、`articles-rows.json` や `local-data/` というファイルが追跡されていること。パターンは値そのものを書かず「接頭辞＋十分な長さ」で判定し（例：接頭辞だけの記述には当たらない）、チェック用スクリプト自身は走査対象から外す。
- **CI**：`.github/workflows/ci.yml` に 1 ジョブ（`ubuntu-latest`、`timeout-minutes: 10`、`on: push(main)` と `pull_request`、同じブランチの古い実行は取り消し）。手順：`npm ci` → 型チェック → 秘密チェック → 単体・API → Chromium だけ入れて e2e。キャッシュは `actions/setup-node` の npm キャッシュのみ。LFS・Codespaces・成果物の大きなアップロードは使わない。

---

## 10. 制約

- **公開リポジトリ**。トークン・キー・秘密の値、個人の連絡先・メール・電話・住所、Notion の内部 ID やワークスペースの URL を入れない。
- Notion から取ったデータ（Articles の JSON、記事ページのテキスト）はリポジトリに入れない。アプリは `ARTICLES_PATH` でローカルのファイルを読むだけ。`.gitignore` に `local-data/`、`*.local.json`、`articles-rows*.json`、`.cache/`、`test-results/`、`playwright-report/`、`.env*` を入れる。
- テスト・スクリーンショットに使うのは架空記事の fixture だけ。
- 外部 API キーを使わない。ネットワークに出るのは任意の claude CLI 要約だけ（既定は無効）。
- GitHub で費用のかかるもの（重い Actions、LFS、Codespaces）を使わない。CI は 1 ジョブ 10 分以内。
- コマンドにはすべて timeout を付ける。`git push` はしない。コミットメッセージとドキュメントは日本語。
- 抽出は規則ベースなので取りこぼし・誤りがある。画面で「自動抽出（下書き）」と明示し、精度を誇張しない。
- 読み込めるのは書き出し済みの 1 ファイル（今回は 100 件の先頭ページ）。ページ送りの統合は対象外。

---

## 11. GREEN when（これが全部満たされたら完成）

### 単体
- [ ] 正規化・文分割・記事 ID・最長一致・候補抽出・除外語・手がかり語規則・共起の上限のテストが通る
- [ ] fixture から 2 回組み立てた結果が `builtAt` 以外で完全一致し、記事の順番を入れ替えても一致する
- [ ] fixture の組み立て結果がスナップショットと一致する
- [ ] カバー率と判定（答えられる／一部／答えられない）、経路（直接・2 段・無し・4 段上限）のテストが通る
- [ ] loader が `{results}` 形・配列形・欄の欠けを読み、壊れた JSON は `DATA_INVALID`、無いファイルは `DATA_NOT_FOUND` を返す
- [ ] loader の出力に Notion の URL・ID、`Processing Note` が残らない

### API
- [ ] `/api/health`・`/api/concepts`・`/api/concepts/:id`・`/api/graph`・`/api/ask`・`/api/examples` が fixture で 200 と期待どおりの形を返す
- [ ] 空の質問・長すぎる質問で 400、存在しない概念で 404
- [ ] データファイルが無いとき 503 `DATA_NOT_FOUND`、壊れているとき 503 `DATA_INVALID`、サーバーは落ちない
- [ ] 0 件のデータで全エンドポイントが 200 と空の結果を返す
- [ ] どの応答にも Notion の URL・ID、ローカルのファイルパスが含まれない

### e2e（`desktop` 1280px と `iphone-390` 390px の両方で）
- [ ] グラフ画面：初期の中心が出る → 隣の概念をタップすると中心が移りパンくずが伸びる → パンくずで戻れる
- [ ] 概念詳細：関係と出典記事が出て、記事リンクは新しいタブで外部 URL を開く設定になっている
- [ ] 質問画面：例の質問を押すと経路と根拠の記事が出る。答えられない質問では「答えられません」と候補が出る。`?q=` 付きで再読み込みしても同じ結果
- [ ] 読み込み中：応答を遅らせるとスケルトンと「読み込み中…」が出る
- [ ] エラー：API が 500 を返すとエラー表示と「もう一度試す」が出て、押すと回復する
- [ ] 0 件：空の fixture で「記事がありません」が出る。検索 0 件で「見つかりませんでした」が出る
- [ ] データファイルが無いとき：案内画面に `ARTICLES_PATH` の説明が出る（パスそのものは出ない）
- [ ] 390px で全画面とも横スクロールが出ず、主要ボタンの高さが 44px 以上
- [ ] サンプルデータ使用中は帯で知らせる

### 全体
- [ ] `npm start` の 1 コマンドで起動し、`ARTICLES_PATH` 未設定ならサンプル、設定すればそのファイルで動く
- [ ] `ASK_WITH_CLAUDE` 未設定、または `claude` が無くても全機能が動く
- [ ] `scripts/check-secrets.mjs` が通り、Notion データ・秘密・個人情報が追跡されていない
- [ ] CI（1 ジョブ）が 10 分以内に通る
