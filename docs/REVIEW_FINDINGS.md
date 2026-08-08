# 同時並行作業時間計測支援ツール コードレビュー指摘一覧

| 項目     | 内容                                                                    |
| -------- | ----------------------------------------------------------------------- |
| 文書番号 | PWT-REVIEW-001                                                          |
| 版数     | 1.6                                                                     |
| 作成日   | 2026-08-01                                                              |
| 対象     | Step 5 完了時点の全体、および Step 6 PR-A・PR-B1 完了時点の追加レビュー |
| 参照文書 | PWT-PLAN-001 版数1.1（`docs/IMPLEMENTATION_PLAN.md`）                   |
| 取扱     | 公開可能。組織固有情報および実運用データを含めないこと                  |

## 改訂履歴

| 版数 | 日付       | 変更内容                                             |
| ---- | ---------- | ---------------------------------------------------- |
| 1.0  | 2026-08-01 | 初版作成。Step 5 完了時点の全体レビュー指摘29件を記載 |
| 1.1  | 2026-08-01 | 並行レビューの結果を統合。逐次入力、数値変換、ツリー再描画、インポート整合性、アーカイブ表示の補足を追記 |
| 1.2  | 2026-08-02 | Step 6 着手前の対応分（A-1、A-2、B-3、B-4、B-5、C-7、C-11、C-12、D-17、E-20、E-22、E-24、F-27）を対応済みとして記録。残りの対応時期は据え置き |
| 1.3  | 2026-08-03 | E-23（UI層の単体テストとカバレッジ計測）を対応済みとして記録 |
| 1.4  | 2026-08-03 | Step 6 PR-A 完了時点の Sol 再レビュー結果を追記。日時の夏時間境界、変更履歴の対象・操作整合、`datetime-local` 検証契約を記録 |
| 1.5  | 2026-08-03 | SOL-1、SOL-3 を対応済みとして記録。夏時間は「対応しない」と決定（日本での個人利用が前提）。SOL-2 は Step 10 前へ据え置き |
| 1.6  | 2026-08-03 | Step 6 PR-B1 の対応分（B-6）を記録。D-16 はラベルの寄せ先（`src/ui/labels.js`）を用意して一部対応 |

## 0. 本書の位置づけ

本書は Step 5 完了時点でプロジェクト全体をレビューした結果のスナップショットである。行番号は作成日（版数1.0）時点のコードに対するものであり、コードの変更に追随しない。

総評: ドメイン層（工数計算・丸め位置）と保存層（トランザクション作法・契約テスト）の品質は高い。一方、UI 層の「描画と状態管理の規約」が未確立であり、実害のあるバグ2件（A-1、A-2）と、Step 6 着手前に方針決定が必要な構造課題（B分類）があった。

各指摘の形式: **対象** / **内容** / **推奨対応時期** / **状況**。

## 0.1 対応状況（版数1.6 時点）

初版29件のうち次の16件へ対応した（Step 6 着手前の分＋B-6）。残る13件は各 Step の実装時に扱う（レビュー指摘 FB-8）。

| 分類 | 対応済み | 残り |
| ---- | -------- | ---- |
| A（実害のあるバグ） | A-1、A-2 | — |
| B（構造課題） | B-3、B-4、B-5、B-6 | — |
| C（データ整合） | C-7、C-11、C-12 | C-8、C-9、C-10、C-13 |
| D（UI・表示） | D-17 | D-14、D-15、D-16、D-18、D-19 |
| E（テスト・開発体験） | E-20、E-22、E-23、E-24 | E-21 |
| F（軽微・設計の芽） | F-27、F-25 | F-26、F-28、F-29 |

対応で新設・変更した規約は次の3つである。個別の指摘ではなく、以後の実装が従う土台として扱う。

1. **再描画の規約**（`src/app/store.js`）。`dataset`/`view`/`selection` の変更は `setState` のみ、ビュー内部の状態はそのビューの `render()` のみ、値だけの変化は部分更新（`dom.js` の `setText`/`setNote`/`replaceOptions`）。入力欄への打ち込みでは再描画しない。
2. **保存経路の規約**（`src/app/persistence.js`）。読み込みから書き込みまでを `persistence.run()` の1区間として直列化する。アクションは `loadAll()` を自分で呼ばない。
3. **状態ガードの規約**（`src/domain/runStatus.js`）。実施回の内容を書き換えるアクションは `isRunEditable()` を通す。

---

## A. 実害のあるバグ（対応済み）

### A-1 入力中の `render()` 全再描画でフォーカスが失われる

- 対象: `src/ui/views/projectView.js:479-483`（今回数量）、`src/ui/views/projectFormView.js:201-208`（対象種別）
- 内容: `input` イベントごとに `render()`（全再描画）を呼ぶ。`replaceChildren` は DOM を全消去するため、フォーカス中の `<input>` ごと破棄され、フォーカスが body へ飛ぶ。手打ちで複数桁を入力すると1文字目で入力欄から抜ける。E2E は `fill()`（input イベント1回）を使うため、この不具合を検出できない。`src/ui/views/templateView.js:7-9` は「入力欄への打ち込みでは再描画しない」と明記して同じ罠を回避しており、ビュー間で規律が不一致。
- 関連する数値入力の問題: `projectFormView.js` と `projectView.js` は数量を `Number.parseInt()` で変換するため、`1.5` や `1e3` のような入力を不正値として拒否せず、それぞれ `1` として保存しうる。`Number()` で全体を変換し、`Number.isInteger()` で整数性を検査する。テンプレートの表示順入力にも同じ `parseInt()` があるため、数値入力全体の規約として統一する。
- 推奨対応時期: 即時（Step 6 着手前）
- 状況: **対応済み（2026-08-02）**。再描画の規約を `store.js` へ明文化し、入力に連動する表示を部分更新へ置き換えた。今回数量の先読みは `setNote`、生成対象の選択件数は `setText`、バリエーション候補は `replaceOptions` で対象ノードだけを書き換える。数値変換は `src/ui/numeric.js` の `toIntegerInput` / `toOptionalIntegerInput` へ集約し、`parseInt` の使用箇所（案件登録・実施回追加・数量修正2種・テンプレートの表示順）をすべて置き換えた。E2E に「1文字ずつ打鍵してもフォーカスと値が保たれる」「`1.5` は整数として拒否される」を追加（`tests/e2e/project.spec.js`）。前者は旧実装で落ちることを確認済み。

### A-2 実施回詳細で作業項目をクリックしても何も起きない

- 対象: `src/main.js:201-203`、`src/app/store.js:47-54`
- 内容: `runView` の `onSelectTask` は `store.setState()` を呼ぶだけで `render()` を呼ばない。かつ `store.subscribe` はアプリ全体で購読者ゼロの死にコードであるため、再描画は起きず、クリックが無反応になる。根因は「`setState` 後に `render()` を書き忘れても誰も気づかない」構造。`store.subscribe(render)` を1本張るか、`subscribe` を削除して手動描画に統一するか、方針を決める必要がある。
- 同じ根因の別症状: 総予定数または今回数量の修正後、`projectView` の詳細ペインは再描画されるが、左ツリーの「残数」は `tree.render()` が呼ばれず古い値のまま残る。保存後に複数の表示領域が同じデータセットを参照する場合も含め、ストア更新と全画面への反映を1つの経路へ統一する。
- 推奨対応時期: 即時（Step 6 着手前）
- 状況: **対応済み（2026-08-02）**。`main.js` で `store.subscribe(render)` を1本張り、`setState` 後の明示的な `render()` 呼び出しをすべて削除した。書き忘れが起こりえない形になり、保存後は詳細ペインと左ツリーが同じ経路で更新される。あわせて作業項目の選択に視覚的な結果を持たせた（実施回詳細の行に `aria-current` と選択スタイル、左ツリー側は実施回ノードを自動展開）。E2E に「数量修正でツリーの残数も同時に更新される」「作業項目クリックで選択状態になる」を追加。

---

## B. Step 6（時刻入力）着手前に方針決定が必要な構造課題

### B-3 全再描画方式が「1分ごとの再評価」に耐えない

- 対象: `src/app/store.js:8-9`（全件再描画の宣言）、`src/ui/` 全般
- 内容: Step 6 では進行中区間の経過時間表示としきい値超過の1分ごと再評価（仕様8.8、計画書§3.4）が入る。1分ごとに `render()` を呼ぶと、記入途中の入力が毎分消え（A-1 と同じ機構）、フォーカス・スクロール位置・datalist ポップアップが毎分リセットされ、展開中のツリー全体の DOM を毎分再生成する。時間表示だけを `textContent` 差し替えで更新する部分更新経路を先に用意する必要がある。
- 推奨対応時期: Step 6 着手前
- 状況: **対応済み（2026-08-02）**。部分更新の道具を `src/ui/dom.js` へ用意した（`setText` / `setNote` / `replaceOptions`）。「値だけが変わり構造は変わらない」更新はこの経路を通すことを `store.js` の規約3として定めてある。Step 6 の経過時間表示は、時間を出すノードの参照を持ってこの経路で毎分書き換える。

### B-4 保存経路に lost update 対策がない

- 対象: `src/app/actions/projectActions.js:139,204,243`、`src/app/persistence.js`
- 内容: 各アクションが独立に `loadAll()` → メモリ上で改変 → WorkRun 全体を `saveEntity` で書き戻す read-modify-write であり、直列化も版管理もない。同一 WorkRun への2操作が非同期に重なると後勝ちで前者が消える。Step 6 は「項目Aで開始 → 項目Bで開始」のように同一 WorkRun への連続書き込みが常態になる。`persistence.run` のキュー直列化、または `updatedAt` による楽観ロックのいずれかを決める。
- 推奨対応時期: Step 6 着手前
- 状況: **対応済み（2026-08-02）**。楽観ロックではなくキュー直列化を採る（版管理を持たない現状で、競合時のUIを別途設計せずに済むため）。`persistence.run(plan)` が読み込み・検証・書き込みを1区間として待ち行列で実行し、アクション側の `loadAll()` を廃止した。1つの失敗で以降が止まらないよう、待ち行列は成否に関わらず次へ進む。結合テストで「同時に実施回を作ると2件目が超過として差し戻される」「実施回の追加と数量修正が同時でも累計判定が最新を見る」を固定。直列化を外すとこの2件が落ちることを確認済み。

### B-5 `persistence.run()` が書き込み成功後の読込失敗を「保存失敗」と誤表示する

- 対象: `src/app/persistence.js:80-101`
- 内容: `write()` 成功後に必ず `adapter.loadAll()` を呼び、その失敗も catch 節で `SAVE_STATE.FAILED`「保存に失敗しました」と表示する。書き込みは成功しているため利用者が誤認して再操作する恐れがある。また操作のたびに全案件・全実施回・全履歴を読み直す設計であり、Step 6 の高頻度操作で効率が悪化する。
- 推奨対応時期: Step 6 着手前
- 状況: **対応済み（2026-08-02）**。書き込み成功後は先に成功を確定させ、読み直しの失敗は「保存しました」＋注記（保存状態表示の詳細欄）として扱う。`dataset` は `null` で返し、`main.js` は古い内容で画面を上書きしない。なお操作のたびに全件を読み直す点は据え置く。Step 6 の高頻度操作で実測して問題が出たら、そのときに差分読み込みを検討する。
- 補足の対応: `plan` が投げた場合（検証で弾いた場合）は保存を試みていないため、保存状態を「失敗」へ動かさない。

### B-6 `renderDetail` の if 連鎖ルーティングが残り4画面でスケールしない

- 対象: `src/main.js:258-279`
- 内容: `view` と選択の深さによる分岐が if 連鎖で埋まっており、集計・アーカイブ・設定・作業項目詳細を足すと分岐が交差する。`VIEW → {render, reset}` の登録テーブル＋案件画面内サブルート（project / run / task）の2段構成へ分割する。未知ビューが現在 default で `projectView.render()` に落ちる点も、明示的なプレースホルダへ改める。
- 推奨対応時期: Step 6 着手前（作業項目詳細ビューを足すタイミング）
- 状況: **対応済み（2026-08-03、Step 6 PR-B1）**。`views` を `Map<VIEW, {render, reset?}>` の登録表にし、`navigate()` は行き先の `reset()` だけを呼ぶ。案件画面の中は `renderProjectsView()` が選択の深さ（作業項目 → 実施回 → 案件）で分ける2段構成とした。未登録のビュー名は `placeholderView.js` の受け皿へ落とし、案件詳細へは落ちない。集計・アーカイブ・設定も同じ受け皿を登録してあり、Step 8 以降はここを差し替える。

---

## C. データ整合の穴（顕在化は先の Step）

### C-7 旧版テンプレートから改訂でき、有効版が2つ並ぶ

- 対象: `src/app/actions/templateActions.js:111-141`、`src/domain/templateOps.js:50-63`
- 内容: `reviseTemplateAction` は改訂元 `current.active === true` を確認しない。旧版の `templateId` を渡すと、本当の有効版が残ったまま新版も `active: true` で保存され、同一 `targetType`/`variant` に有効版が2つ並ぶ。`version: current.version + 1` も系列内最大版基準でないため版番号が重複する。`findActiveTemplate` と `activeTemplates` はこの不変条件を暗黙に前提としており、壊れるとどの版が選ばれるか実装依存になる。`saveEntities` による原子性の担保（計画書§3.1.1）は正しく、同じ不変条件の入口検証が1本抜けている状態。
- 推奨対応時期: 早期（Step 6 前後で可。改訂UIが旧版IDを渡さない現状でも防御を入れる）
- 状況: **対応済み（2026-08-02）**。`reviseTemplateAction` が改訂元の `active === true` を確認する。版番号は `nextTemplateVersion(taskTemplates, templateSeriesId)` で系列内の最大版を基準に繰り上げる。結合テストで「旧版からは改訂できない（有効版が2つ並ばない）」「版番号は系列内で重複しない」を固定。なお C-10 の取り込み時検証は別途 Step 9 で行う。

### C-8 `MemoryAdapter.importAll` が案件IDの一意制約を検査しない（契約不一致）

- 対象: `src/storage/MemoryAdapter.js:161-189` vs `src/storage/IndexedDbAdapter.js:236-279`
- 内容: `saveEntity`/`saveEntities` では両実装とも制約違反を投げるのに、`importAll` では Memory 側だけ `projectId` 重複を素通しする。重複 JSON の取り込みは IndexedDB では `ConstraintError` で拒否、Memory では成功し、契約テストにもこのケースがないため、Step 9 のインポート実装時に本番だけ落ちる形で顕在化する。
- 推奨対応時期: Step 9 前（契約テストへケース追加とあわせて）
- 状況: **対応済み（2026-08-07、Step 9）**。構造検証と業務整合性検証を統合した `validateImport()` を両アダプターの `importAll()` から共通利用し、案件ID重複は書き込み開始前に `validation` として拒否する。両実装へ同じ契約テストを通し、拒否後も既存データが一致することを確認した。

### C-9 アダプタ間の返却順序・欠落時挙動の不一致

- 対象: `src/storage/MemoryAdapter.js:71-79,202-212` vs `src/storage/IndexedDbAdapter.js:147-169,294-308`
- 内容: IndexedDB の `getAll()` は主キー（UUID文字列）昇順、Memory は `Map` の挿入順を返す。契約テストは件数1件か `.sort()` 後の比較のため差を検出しない。設定欠落時の `settings` が IndexedDB は `null`、Memory は `undefined` になる差、`close()` 後に IndexedDB は全操作失敗・Memory は動き続ける差もある。契約として「順序不定。表示側で必ずソートする」を明記するか、両者を揃える。
- 推奨対応時期: Step 8 前（集計一覧が並び順に依存し始める前）
- 状況: **対応済み（2026-08-05、Step 8 準備）**。`StorageAdapter.loadAll()` の契約へ「各コレクションは主キーの昇順」「設定が無ければ `null`」を明記し、`MemoryAdapter` を IndexedDB 側へ揃えた（`sortedByKey()`、`settings === undefined ? null`）。並び順は契約テスト3件（保存順と異なる順での投入、置き換え、削除）で両実装に通す。あわせて「画面が並び順をこの契約に頼ってはならない。表示順・外部項目コード順・時刻順は表示側で明示的に並べ替える」ことも契約へ書いた。設定欠落は `initialize()` が既定値を書き `deleteEntity()` が設定の削除を拒むため公開APIから到達せず、契約テストは置いていない（実装をそろえたのは防御である旨を明記）。`close()` 後の挙動差は据え置き（後始末でしか呼ばない）。

### C-10 `schema.js` に業務的整合性の検証がない

- 対象: `src/domain/schema.js:292-317`、`src/domain/effort.js:44-53`
- 内容: インポート検証が構造検証のみで、`endAt >= startAt`（仕様8.9.3）、主キー重複（同一 `runId` 2件は put で黙って上書き）、`projectGroupId` の参照整合、`status` と `transferredAt`/`archivedAt` の整合を見ない。特に `endAt < startAt` は `effort.js` が0秒に丸めて黙って飲み込むため、取り込み後に工数が静かに欠落する。どこまで拒否するかを決める。
- テンプレートの不変条件も検証対象に含める。少なくとも「同一の対象種別×バリエーションに有効版は1件」「同一 `templateSeriesId` 内で版番号と `templateId` が重複しない」を取り込み前に確認する。C-7 のアクション入口検証と両方で不変条件を守る。
- 追記（2026-08-06、敵対的検証 PWT-REVIEW-005 §4.2）: **孤立参照**も対象へ含める。存在しない `templateId` を指す実施回、存在しない `runId` / `targetId` を指す変更履歴、テンプレートに無い `taskDefinitionId` を持つ作業項目実績が取り込まれた場合、集計は黙って通るが元をたどれない記録が残る。拒否するか警告にとどめるかを決めて明記する。
- 追記（2026-08-06、Step 8）: `status` と中身の整合も対象へ含める。Step 8 で `status="transferred"` と未終了区間が同居しないことをアクション層で保証したが（S8-1）、インポート経路にはこのガードが無い。取り込んだJSONが同じ矛盾を持ちうる。
- 推奨対応時期: Step 9 前
- 状況: **対応済み（2026-08-07、Step 9）**。`src/domain/integrity.js` を追加し、構造検証後に主キー・入れ子識別子・案件ID・有効テンプレート・系列内版番号の一意性、案件／テンプレート／作業項目定義の参照、区間前後、実施回状態と未終了区間・`transferredAt`・`archivedAt` の整合、変更履歴の操作と対象種別を検証する。変更履歴の `targetId` は削除済み対象を指すことが正常なので、現存レコードへの外部キーにはせず、操作と対象種別の対応を契約とした。区間重複・累計超過・外部コード未設定は仕様どおり取り込みを許す。単体テストと両アダプターの契約テストで拒否時の全データ不変を確認した。

### C-11 サンプルテンプレート投入が非原子的で、部分投入が回復不能

- 対象: `src/app/bootstrap.js:33-42`
- 内容: 投入条件が「`taskTemplates.length === 0`」のみで、`saveEntity` のループ途中で失敗すると1件でも入った時点で次回以降は二度と投入されない。`saveEntities` で1トランザクションにまとめれば全か無かになる。`StorageAdapter` へ `saveEntities` を追加した理由（計画書§3.1.1）がそのまま当てはまる。
- 推奨対応時期: 早期（修正が小さい）
- 状況: **対応済み（2026-08-02）**。`saveEntities` で1トランザクションにまとめ、全か無かにした。

### C-12 転記済み／アーカイブの実施回でも数量を変更できる

- 対象: `src/app/actions/projectActions.js:201-277`
- 内容: `updateTotalQuantity` / `updateRunQuantity` が `run.status` を確認しない。仕様7.2 の「転記済み／アーカイブは閲覧のみ」に対するガードがない。Step 10 の範囲ではあるが、Step 6・7 でアクションが増える前に「どのアクションが状態ガードを持つか」の規約を決めないと同じ穴が量産される。
- 推奨対応時期: 規約決めは Step 6 前、実装は Step 10
- 状況: **対応済み（2026-08-02）**。`src/domain/runStatus.js` に判定（`isRunEditable`）と規約を置き、`updateRunQuantity` へ適用した。呼び出し先が無い規約は規約にならないため、現存する唯一の該当アクションには今のうちに通してある。`updateTotalQuantity` は案件グループの値でありガードの対象外（その旨をコードにも書いた）。Step 6・7 で追加するアクション（区間、直接入力）は同じ判定を通す。状態遷移そのものの規則（7.1）は Step 10 で同モジュールへ足す。

### C-13 `IndexedDbAdapter` の接続管理の穴

- 対象: `src/storage/IndexedDbAdapter.js:96-131`
- 内容: (a) `db.onversionchange` ハンドラがなく、将来 DB 版を上げる改訂時に、開きっぱなしの他タブが upgrade を永久にブロックする。(b) `initialize()` は `this.db === null` チェックと `await` の間に隙間があり、並行呼び出しで DB を2つ開く。
- 推奨対応時期: Step 11（多重タブ対応）まで
- 状況: **対応済み（2026-08-08、Step 11）**。(a) `onversionchange` で自分の接続を閉じ、以後の操作は「別のタブが更新したため再読み込みを」の文言で拒む。修正前は契約テストが実際にタイムアウトで再現した（版2の open が `onsuccess` へ進めない）。(b) 開きかけの Promise を持ち、並行 initialize はそこへ合流させる。`openDatabase` の呼び出し回数を数える契約テストで固定した。

---

## D. UI・表示の一貫性

### D-14 「第n回」の採番がツリーと案件詳細で食い違う

- 対象: `src/ui/tree.js:139,166`（アーカイブ除外後の添字）vs `src/ui/views/projectView.js:81-90`（全件の添字）
- 内容: 表示位置由来の採番が2箇所に別ロジックで存在する。Step 10 でアーカイブを実装した瞬間、同じ実施回がツリーと詳細で異なる番号になる。採番関数を1箇所へ切り出すか、WorkRun に連番を持たせる。
- アーカイブの表示範囲自体も不一致。ツリーは `status === "archived"` を除外する一方、案件詳細の実施回一覧は累計用の全件配列をそのまま描画するため、「通常一覧から分離する」という仕様に反してアーカイブ済みが残る。数量集計用の全件と、画面表示用の非アーカイブ一覧を明示的に分ける。
- 推奨対応時期: Step 10 前
- 状況: **対応済み（2026-08-07、Step 10 準備）**。`src/domain/runOrder.js` を新設し、並べ替え（作業日→作成日時）と採番を1か所へ集約した。**採番はアーカイブ済みも含めた全件で行い、絞り込みは採番の後に行う**。表示中だけで数えると第1回をアーカイブした瞬間に第2回が繰り上がり、利用者が番号で指した記録と突き合わせられなくなるためである。案件詳細の実施回一覧も `activeRuns()` を通してアーカイブ済みを分離し、件数を案内文へ出す。数量の累計は従来どおり全件を数える（8.2.5）。単体テスト12件で「アーカイブしても他の回の番号が動かない」を固定した。

### D-15 `validateRunDraft` の warnings と「数量超過」が1対1に癒着

- 対象: `src/domain/validation.js:244-283`、`src/app/actions/projectActions.js:169-171,215-217,263-265`
- 内容: アクション側が `warnings.length > 0` を無条件に `QuantityOverflowError`（累計超過の確認）へ変換する。Step 7 の直接入力重複候補警告（8.9.8）など別種の警告を足した瞬間に誤爆する。警告へ種別コード（`{code, path, message}`）を持たせる。
- 推奨対応時期: Step 7 前
- 状況: **対応済み（2026-08-05、Step 7 PR-A）**。`Problems` クラスを `src/domain/problems.js` へ一本化し、`validation.js` と `intervalOps.js` が共有する。`validateRunDraft` / `validateTotalQuantityChange` の警告は `VALIDATION_WARNING.QUANTITY_OVERFLOW` を持つ `{code, path, message}` になった。`projectActions.js` の3箇所は `warnings.length > 0` をやめ、`hasWarning(warnings, VALIDATION_WARNING.QUANTITY_OVERFLOW)` で差し戻す。累計超過以外の警告では確認を求めないことを結合テストで固定した。

### D-16 状態ラベル定数の重複

- 対象: `RUN_STATUS_LABEL` が `src/ui/tree.js:29-34` / `src/ui/views/projectView.js:25-30` / `src/ui/views/runView.js:26-31` に3重複。`TASK_STATE_LABEL` が `tree.js:21-26` / `runView.js:18-23` に2重複
- 内容: Step 8 の集計画面でさらに増える前に `src/ui/labels.js` 等へ一本化する。`runView.js:45-52` の `toMinutesLabel` も集計画面で共有になる。
- 推奨対応時期: Step 8 前
- 状況: 一部対応（2026-08-03、Step 6 PR-A / PR-B1）。`TASK_STATE_LABEL` を `src/domain/taskState.js`、`INTERVAL_TYPE_LABEL` と `TASK_OPERATION_LABEL` を定義と同じ場所（`effort.js` / `taskState.js`）へ置いた。画面だけの語と書式は `src/ui/labels.js` を新設して `RUN_STATUS_LABEL` と `toMinutesLabel` を移し、`runView.js` の複製を解消した。`taskDetailView.js` はこの寄せ先を使っているため、複製は増えていない。`tree.js` と `projectView.js` に残る複製を向け直すのは予定どおり Step 8 前に行う。
- 状況: **対応済み（2026-08-05、Step 8 準備）**。`tree.js` と `projectView.js` の `RUN_STATUS_LABEL` を `ui/labels.js` へ向け直した。`tree.js` の `TASK_STATE_LABEL` は `{text, mark}` の独自形だったため、語は `domain/taskState.js` の `TASK_STATE_LABEL` を使い、ツリー固有の記号だけを `TASK_STATE_MARK` として残した。あわせて FB-2 の追記で挙がっていた `formatIsoForHuman` を `domain/history.js` から `domain/datetime.js` へ移した（汎用の日時整形であり、UI が「履歴」モジュールから表示用関数を取り込む形は区間履歴と変更履歴の取り違えを招く）。

### D-17 `label` の `for` が実際の入力欄と紐づいていない

- 対象: `src/ui/views/projectFormView.js:193,246,251`、`src/ui/dom.js:100-107`
- 内容: `field()` へ `suggestInput()` が返すラッパー `<span class="suggest">` を渡しているため、`id` が span に付き、`<label for>` が実際の `<input>` と無関係になる。ラベルクリックでフォーカスが移らず、支援技術にもラベルが伝わらない（対象種別・バリエーションの2欄）。`suggestInput` 側で生の `input` を `field` へ渡し、`datalist` を兄弟として返す形へ。
- 推奨対応時期: 早期（修正が小さい）
- 状況: **対応済み（2026-08-02）**。`suggestInput` が入力欄と `datalist` を別々に返し、`field()` は `after` で `datalist` を入力欄の兄弟として置く。`field()` に「`input` には必ず生の入力要素を渡す」旨を明記した。不要になった `.suggest` の CSS を削除。E2E に「ラベルを押すと対応する入力欄へフォーカスが移る」を追加。

### D-18 フォーカス管理・読み上げ対応が未整備

- 対象: `src/ui/views/*.js` のエラー表示、`src/ui/statusBar.js:19-39`、`src/ui/tree.js`、`src/ui/shell.js:63-64`
- 内容: (a) 保存失敗時、`render()` で押したボタンごと消えるためフォーカスが body へ戻る。(b) 保存状態表示に `aria-live` がない（警告領域にはある）。(c) ツリーに `role="tree"` 系・矢印キー移動がなく、状態記号 `●/○/◐/✓` が AT へ伝わらない。(d) 未実装ナビが `disabled` でフォーカス不能、`title` はキーボード利用者に届かない。仕様13章のキーボード操作要件に関わる。
- 推奨対応時期: Step 11（横断要件）でまとめて
- 状況: **対応済み（2026-08-08、Step 11）**。(a) は Step 7 PR-A の `applyBusy()`（保存中は描き直さない）と `rowForm?.focus()` で対応済みだったため、Step 11 の追加は無い。(b) 保存成否表示へ `role="status"` と `aria-live="polite"` を付けた。(c) ツリーへ tree / group / treeitem の役割、roving tabindex、矢印キー移動（↑↓→←、Home/End）を実装し、状態記号は `aria-hidden` にして語を `aria-label` へ含めた。(d) 7画面がすべて実装済みになったため、`disabled` の分岐ごと削除した。単体10件と E2E で固定。

### D-19 viewport 固定とレスポンシブ CSS の矛盾

- 対象: `index.html:5`（`<meta name="viewport" content="width=1280">`）vs `src/styles/layout.css:238`（`@media (max-width: 1279px)`）
- 内容: viewport を1280へ固定するとこのメディアクエリは実機では発火しない（スクリーンショット試験は `setViewportSize` なので効く）。1280固定か狭幅対応か、意図をどちらかへ寄せる。
- 推奨対応時期: Step 12（仕上げ）まで

---

## E. テスト・開発体験

### E-20 E2E の初期化手順が2系統あり、片方は自ら「使うな」と書いた方式

- 対象: `tests/e2e/helpers.js:14-21`（`clear` 方式を採用し `deleteDatabase` の問題を明記）vs `tests/e2e/bootstrap.spec.js:18-29`、`tests/e2e/template.spec.js:19-31`（`deleteDatabase` を使用）
- 内容: 現状 `workers: 1` のファイル名順で偶然通っているが、`--grep` や単体ファイル実行、順序変更で「前のファイルのデータが残る → 起動ビューが変わる → タイムアウト」の形で落ちる。flaky の芽として最有力。`helpers.js` の方式へ統一する。あわせて `helpers.js:37` の `stores` に `settings` が含まれておらず、設定画面実装後に試験間で設定が漏れる。
- 推奨対応時期: 早期（Step 6 で E2E を足す前）
- 状況: **対応済み（2026-08-02）**。`bootstrap.spec.js` と `template.spec.js` の独自 `openFresh` を削除し、`helpers.js` の1本へ統一した（`SAMPLE_COUNT` も同様）。`deleteDatabase` はリポジトリから消えている。`stores` へ `settings` を追加した。`initialize()` が既定値を入れ直すため、設定画面の実装後も試験間で設定が漏れない。

### E-21 「外部項目コード順へ並べ替え」E2E が実質無検証

- 対象: `tests/e2e/project.spec.js:218-231`
- 内容: 期待値が既定の表示順と完全に同一であり、並べ替え操作を消してもテストが通る。表示順と自然順が食い違うテンプレートを使う並びへ変える（自然順そのものは `tests/unit/naturalSort.test.js` で担保済み）。
- 推奨対応時期: Step 8 前
- 状況: **対応済み（2026-08-05、Step 8 準備）**。サンプルの「対象種別A / 拡張」は表示順（受入確認 X-100 → 本作業 X-1000 → 追加加工 X-2000 → 検査 X-1100）と自然順（X-100 < X-1000 < X-1100 < X-2000）が食い違うため、これを使う試験へ変えた。並べ替え前の並びも先に固定してある。**並べ替え操作を消すと落ちることを実際に確認した**（`追加加工` と `検査` が入れ替わる）。未設定を末尾へ置く点は「標準」を使う別の試験へ分けた。

### E-22 `test:e2e` がスクリーンショット試験を毎回実行する

- 対象: `package.json:11`、`tests/e2e/screenshots.spec.js:5`
- 内容: 「`--grep @screenshot` で実行する」「合否判定は行わない」と書かれた試験10件が既定実行へ混ざり、毎回 `test-results/*.png` を書き出す。`test:e2e` へ `--grep-invert @screenshot` を付け、別途 `test:e2e:shots` を用意する。`lint` / `format` / `test:coverage` スクリプトがない点も含めて整備の余地。
- 推奨対応時期: 早期（修正が小さい）
- 状況: **対応済み（2026-08-02）**。`test:e2e` は `--grep-invert @screenshot`、`test:e2e:shots` を新設した。`lint` / `format` / `test:coverage` は見送る。いずれも devDependencies の追加を伴い（`test:coverage` は `@vitest/coverage-v8`）、この修正の範囲を超える。カバレッジは E-23 で扱う。

### E-23 UI 層の単体テストがゼロで、カバレッジ計測手段もない

- 対象: `vitest.config.js:7`（`environment: 'node'`）、`tests/unit/`
- 内容: `dom.js` の属性処理や `tree.js` の並べ替え・展開キー・アーカイブ除外は純関数に近く単体テスト向きだが、すべて E2E 頼み。coverage 設定もないため「カバレッジの穴」を測る手段自体がない。
- ~~E2E の追加候補: `fill()` だけでなく、対象種別と今回数量をキーボードで1文字ずつ入力し、複数桁入力後もフォーカスと値が保たれることを確認する。また、総予定数・今回数量の修正後に、案件詳細だけでなく左ツリーの残数も同時に更新されることを検証する。~~ 対応済み（2026-08-02。A-1・A-2 の回帰試験として `tests/e2e/project.spec.js` へ追加）。
- 推奨対応時期: Step 6 以降、UI が複雑化するのに合わせて
- 状況: **対応済み（2026-08-03）**。`@vitest/coverage-v8` と `happy-dom` を開発依存へ追加し、`npm run test:coverage` で計測できるようにした（出力は `test-results/coverage/`）。UI 層の単体テストを新設し、`dom.js`（属性の扱い・部分更新・`field` の `for` 結線）と `numeric.js` は行・分岐とも100%、`tree.js` は並べ替え・展開キー・アーカイブ除外・状態記号・通知を含めて行100%／分岐97.9%。全体は行68.0%で、未計測の大半は `src/ui/views/`（E2Eが受け持つ）である。
- 補足: DOM 実装は happy-dom を選んだ。本アプリが触るのは要素生成・属性・イベント・`textContent` だけで（`innerHTML` 不使用、計画書§4.2）、CSS カスケードやレイアウトの再現は要らない。その範囲なら jsdom より軽い。あわせて `environmentMatchGlobs` が Vitest 4 で廃止されているため、対象ファイル先頭の `// @vitest-environment happy-dom` で切り替えている。
- 派生: `toIntegerInput` の契約を明確にした。`0x10` / `0b11` / `Infinity` を10進数の形で弾き、指数表記（`1e3` → 1000）は `type="number"` が受け付ける表記として通す。

### E-24 開発サーバーが不正な URL エンコードでプロセスごと落ちる

- 対象: `tools/static-server.mjs:59`
- 内容: `decodeURIComponent()` が `/%` 等の不正シーケンスで `URIError` を投げ、async ハンドラ内のため unhandled rejection でプロセスが落ちる（E2E 実行中なら全試験が巻き添え）。try/catch で 400 を返す。なおパストラバーサル対策・127.0.0.1 バインド・GET/HEAD 限定は開発用として妥当。あわせてモジュール読み込みだけで `listen()` する副作用があり、`createStaticServer` を単体テストから使えない。
- 推奨対応時期: 早期（修正が小さい）
- 状況: **対応済み（2026-08-02）**。デコードを `decodeUrlPath()` へ分け、失敗は 400（ルート外の 403 と区別する）。`listen()` は直接起動時のみ行うようにし、`createStaticServer` を読み込むだけでポートを掴まないようにした。`/%` → 400、`/index.html` → 200、`/nope.html` → 404 を手元で確認済み。単体テストは E-23 とあわせて足す。

---

## F. 軽微・設計の芽

### F-25 `datetime.js` の符号規約の混在と Step 6 向け API の不足

- 対象: `src/domain/datetime.js:31-38` vs `:86-94`
- 内容: 同一モジュール内で `offsetMinutes` が `getTimezoneOffset` 規約（西が正）と ISO 規約（東が正）の逆符号で使われている。現時点で実害はないが Step 6 でオフセット計算を触るときの事故要因。また Step 6 に必要な (a) `datetime-local` 値 → オフセット付き ISO 変換、(b) ISO 同士の大小比較、(c) 秒の加減算が未整備で、各所へ `parseIso` 数値比較が散らばる前にここへ集約する。
- 推奨対応時期: Step 6 着手時
- 状況: **対応済み（2026-08-03、Step 6 PR-A）**。公開 API の `offsetMinutes` を ISO 規約（東が正）へ統一し、`Date#getTimezoneOffset()` を呼ぶ箇所を `localOffsetMinutes()` の1か所へ閉じた。`formatOffset()` の引数の意味が変わるため単体テストも直してある。Step 6 向けに `fromDateTimeLocal` / `toDateTimeLocal` / `compareIso` / `addSeconds` と、実装しながら必要になった `localOffsetMinutes` / `offsetMinutesOf` / `isValidDateTimeLocal` を足した。区間の前後判定は `intervalOps.js` から `compareIso` を呼ぶ形にし、`parseIso` の数値比較は散らばっていない。

### F-26 定数・関数の配置の不自然さ

- 対象: `src/domain/templateInstantiate.js:18,138`、`src/domain/schema.js:20-25`、`src/domain/validation.js:16`
- 内容: `INITIAL_RUN_STATUS` と `RUN_STATUS.WORKING` で `'working'` の正が二重定義。Step 10 の `runState.js` 実装前に `RUN_STATUS` へ寄せる。汎用の `normalizeProjectId` が「インスタンス化」モジュールに置かれ `validation.js` がそこへ依存している配置も見直し対象。
- 推奨対応時期: Step 10 前
- 状況: **対応済み（2026-08-07、Step 10 準備）**。`INITIAL_RUN_STATUS` は `RUN_STATUS.WORKING` から導出し、`'working'` の正を1か所にした（「初期状態」という意味は残す）。`normalizeProjectId` は `src/domain/projectId.js` へ移し、登録・重複判定・取り込み検証の3経路が同じ入口を通る形にした。単体テストも新モジュール側へ移した。

### F-27 例外クラスの定義場所と階層の不揃い

- 対象: `src/app/actions/templateActions.js:31-40`、`src/app/actions/projectActions.js:28,36-46,54-65`
- 内容: `projectActions` が `templateActions` から `ValidationError` を import しており、アクションが増えると循環 import の芽になる。`ProjectIdConflictError extends ValidationError` に対し `QuantityOverflowError extends Error` と階層も不揃い。`src/app/errors.js` へ切り出す。`resolveDeps` も両ファイルへ逐語的に重複している。
- 推奨対応時期: Step 6 でアクションを足す前
- 状況: **対応済み（2026-08-02）**。`src/app/errors.js` を新設し、`AppError` を根に `ValidationError`（→ `ProjectIdConflictError`）、`QuantityOverflowError`、`RunNotEditableError` を並べた。`QuantityOverflowError` を `ValidationError` の下に置かないのは、入力が誤っているわけではなく確認を求める差し戻しであるため。`resolveDeps` は `src/app/actions/deps.js` へ切り出して重複を解消。ビューの catch 節に散っていた文言組み立ては `toErrorMessages()` へ集約した。アクション間の import は無くなり、循環の芽を断ってある。

### F-28 `StorageAdapter` の検索3操作が未使用

- 対象: `src/storage/StorageAdapter.js:352,362,372`、`src/app/actions/projectActions.js:96-98,307`
- 内容: `findTaskTemplates` / `findTemplateSeries` / `findProjectGroupByProjectId` は実装・契約テスト済みだが `src/app/` からの呼び出しがゼロで、案件ID一意性検証は全件 `loadAll()` で行っている（計画書§3.1.1 の追加理由が未回収）。さらに `projectActions.js:307` に同名で配列を引数に取る別関数があり、import ミスを誘発する。
- 推奨対応時期: Step 6 以降、実経路で索引を使うタイミングで整理

### F-29 その他の小粒な指摘

- `src/domain/effort.js:44-53`: 「壊れたデータでも画面を壊さない」方針が中途半端。`endAt < startAt` は0秒に飲むが、`startAt` 不正形式は `TypeError`、`participants` 欠落は `.length` で落ちる。方針をモジュール内で統一する。
- `src/domain/effort.js:139-161`: `summarizeRun` の実施回合計転記値は1件でも未終了があると `null`。Step 8 で「確定済み項目のみの合計」を出すなら別値（`confirmedTransferMinutesSum` 等）が必要。
- `src/domain/naturalSort.js:60-81`: 未設定判定は trim 後、比較は trim 前の値で行っており不整合。
- `src/domain/ids.js:20-27`: `crypto.randomUUID` 依存が `domain/` にある。計画書4.1 が明記する意図的例外だが、他のモジュールは `newId` を引数で受ける設計であり浮いている。
- `src/app/bootstrap.js:74-94`: サンプル投入時に `validateTaskTemplate` 相当を通しておらず、サンプル JSON を壊すと「保存はできるがエクスポートで弾かれる」データが生まれる。
- `src/domain/schema.js:156-161`: `settings: undefined` が検証を素通りし `store.put(undefined)` が走りうる（プログラムから直接オブジェクトを渡す経路のみ）。
- ~~`src/ui/dom.js:14`: JSDoc に `html` の記述が残っているが実装に存在しない。~~ 対応済み（2026-08-02。同モジュールを触ったついでに1行修正）。
- `src/ui/tree.js:45-55,173-175`: 展開状態 Set が削除時に掃除されない。`localeCompare` を比較のたびに呼ぶ（`Intl.Collator` の使い回しが定石）。いずれも現行データ量では実害なし。
- `src/ui/views/templateView.js:199` / `src/ui/views/runView.js:101`: 同じ `data-testid="task-row"` を使用。現状は画面が排他だが、素の `getByTestId` はスコープが曖昧。
- ~~`src/main.js:52-62`: サンプル JSON 取得失敗が無言。配布物で `data/` を欠いたとき原因が分からないため、Step 11 の警告領域へ1行出す余地。~~ 対応済み（2026-08-08、Step 11。テンプレートが1件も無い場合に限り警告領域へ出す。既にデータのある環境では初期投入自体が走らないため、毎回の警告は雑音になる）。
- ~~`src/main.js`: `window.onerror` / `unhandledrejection` のハンドラがなく、ブート後の例外が無言で失敗する。~~ 対応済み（2026-08-08、Step 11。警告領域へ1行で出し、同文は重ねない。ブート前の失敗は従来どおり `renderBootFailure` が受ける）。
- `tests/integration/templateActions.test.js:323,335`: そこだけ固定 dbName で他は連番方式。揃える。

---

## G. 良い点（記録として残す）

1. **丸め位置の中核要件が正確で、テストとコメントで固定されている。** `src/domain/effort.js:112-161` は区間ごとに丸めず作業項目合計で一度だけ `ceil` し、実施回合計は「丸め直すのではなく項目別転記値を足す」と明示的に区別している。`tests/unit/effort.test.js:170-258` が間違えやすい2種類の丸め規則を意図コメント付きで固定している。休憩0秒・直接入力に人数を掛けない点も正確。
2. **`innerHTML` 不使用の規律が完全に守られている。** リポジトリ全体で `innerHTML` / `insertAdjacentHTML` / `document.write` の使用はゼロで、生成経路が `dom.js` へ集約されている。`domain/` に DOM・IndexedDB・`Date.now()` の直接参照もない（計画書§4.2 の規律を遵守）。
3. **IndexedDB のトランザクション作法が正しい。** 1トランザクション内でリクエストを同期発行し完了だけ待つ形が全メソッドで徹底され、boolean を索引に含めない判断がコード・アダプタ・計画書の3箇所で一貫して説明されている。`QuotaExceededError` 対応も入口から表示文言まで通電済み。
4. **契約テストが両アダプタへ同一スイートで通り、E2E に固定待ち時間がない。** `describe.each` で `MemoryAdapter` / `IndexedDbAdapter` へ同じ操作を流し、往復一致・全置換・`schemaVersion` 不一致拒否・部分不正データの全件非反映まで検証している。E2E は web-first assertion のみで `waitForTimeout` ゼロ。

---

## H. Step 6 PR-A 完了時点の Sol 再レビュー（2026-08-03）

`feat/step6-pr-a`（`375ee0b`）を対象に、仕様からドメインモデル、公開操作、保存境界、テストまでを再レビューした。既存の C-10 に記録済みのインポート整合性（区間の前後関係、ID重複・参照整合、状態と日時の整合）は、新規指摘として重複登録しない。

実行結果は、単体・結合テスト743件成功、E2E 91件成功、`git diff --check main...HEAD`成功。カバレッジは全体 statements 74.07%、domain statements 94.27%。IndexedDB API の storage 外への漏出、外部URL、`innerHTML`等の危険なHTML挿入について追加問題はなかった。

### SOL-1 夏時間をまたぐ日時入力で保存時刻がずれる

- 重要度: **Major**
- 対象: `src/domain/datetime.js:238-257`、`docs/STEP6_DESIGN.md:143-157`
- 内容: `fromDateTimeLocal(value, offsetMinutes)` は、新規入力には現在日時のローカルオフセット、編集には元区間のオフセットを渡す利用契約になっている。しかし、入力対象日と現在日時または元区間の日付で夏時間の適用状態が異なる地域では、入力した壁時計日時に対応しないオフセットを保存する。`TZ=America/New_York`で、8月時点のオフセット`-04:00`を使って1月15日09:00を変換すると、本来`2026-01-15T09:00:00-05:00`となるべき値が`2026-01-15T09:00:00-04:00`となり、指す瞬間が1時間早くなることを確認した。工数計算は瞬間の差を使うため、区間の端点ごとに誤差が生じうる。
- 契約上の必要事項: 入力された壁時計日時に適用されるローカルオフセットを導出する。夏時間切替時の「存在しない時刻」と「2回存在する時刻」を拒否するか、利用者に選択させるかは仕様にないため、実装前に方針を決める。
- 推奨対応時期: **Step 6 PR-B の日時入力UIへ接続する前**
- 状況: **対応済み（2026-08-03、Step 6 PR-A）**。`fromDateTimeLocal()` の `offsetMinutes` を省略可能にし、省略時は**入力された壁時計日時に対応するローカルオフセット**を求める（その壁時計値で `Date` を組み立て `localOffsetMinutes()` を通す）。`TZ=America/New_York` で1月15日09:00が `-05:00`、8月15日09:00が `-04:00` になることを確認した。
- 曖昧時刻・存在しない時刻の方針（**決定: 夏時間へ対応しない**、2026-08-03）。本ツールは日本での個人利用を前提とするため、専用の扱いは設けない。実装上は次のようになるが、これは上のオフセット導出から従う副次的な結果であって、夏時間のための機構ではない。
  - 存在しない時刻（春の切替）: 壁時計が保たれないため `isValidDateTimeLocal()` / `fromDateTimeLocal()` が拒否する
  - 2回存在する時刻（秋の切替）: 処理系が選ぶ側のオフセットで保存する
- 明示的にオフセットを渡す口は残す。保存済み区間のオフセット（`offsetMinutesOf()`）で書き戻す場合と、試験を実行環境のタイムゾーンから切り離す場合に使う。

### SOL-2 変更履歴の対象種別と操作種別を矛盾させられる

- 重要度: **Minor**（Step 10 で履歴生成経路が増える前に対応）
- 対象: `src/domain/history.js:64-105`、`src/domain/schema.js:336-359`
- 内容: `entityType`と`operation`をそれぞれ既知の列挙値か検証するだけで、組み合わせを検証しない。例えば`entityType: "projectGroup"`と`operation: "intervalDeleted"`の履歴を`buildHistoryEntry()`とインポート検証の双方が受け入れる。現行の区間削除アクションは正しい組み合わせを固定しているため、現在のUI経路での実害はない。
- Evidence状態: **inferred**。仕様11章は対象と操作を列挙しているが、対応表を明文では定義していない。少なくとも現行語義では、`statusReverted`/`workRunDeleted`→`workRun`、`intervalDeleted`→`interval`、`directEntryDeleted`→`directEntry`、`projectGroupDeleted`→`projectGroup`の対応が自然である。対応を契約として確定する場合は仕様または設計メモへ明記する。
- 推奨対応時期: Step 10 の状態遷移・削除操作を追加する前
- 状況: **対応済み（2026-08-07、Step 10 準備）**。Evidence の対応表を `history.js` の `HISTORY_ENTITY_BY_OP` として契約に定めた。`buildHistoryEntry()`（書き込み）と `integrity.js`（取り込み）の両方がこの表を見るため、経路によって通る履歴が変わらない。Step 9 で `integrity.js` へ直書きしていた対応表もここへ寄せた。操作が未知の場合は組み合わせの指摘を出さない（操作そのものの指摘で足りるため）。単体テスト4件を追加した。

### SOL-3 `isValidDateTimeLocal`と変換処理の妥当性判定が一致しない

- 重要度: **Minor**
- 対象: `src/domain/datetime.js:246-270`
- 内容: `isValidDateTimeLocal()`は正規表現だけを確認するため、`2026-02-30T09:00`を`true`と判定する。一方、`fromDateTimeLocal()`は同じ値を`assertIso()`で拒否する。PR-BのUIが前者で保存可否を判断すると、「検証済みだが変換時に例外」という境界になる。
- 推奨対応: 両APIを同じ意味検証へ接続し、実在しない日付・範囲外時刻について同じ結果を返す。SOL-1の日時変換契約を決める際に合わせて扱う。
- 推奨対応時期: Step 6 PR-B の日時入力UIへ接続する前
- 状況: **対応済み（2026-08-03、Step 6 PR-A）**。解析を `parseDateTimeLocal()`（非公開）へ1本化し、`isValidDateTimeLocal()` と `fromDateTimeLocal()` の両方がこれを通る。形式に加えて壁時計日時が実在することも見るため、`2026-02-30T09:00` は両方が拒否する。判定と変換可否が一致することは、妥当な値・実在しない日付・範囲外時刻・形式違い・null を並べた単体テストで固定した。

### Skill適用判断で保留した点

- 夏時間境界は欠陥の再現までは確定したが、曖昧時刻・存在しない時刻の扱いは公開仕様にない。AI判断で業務契約を追加せず、選択事項として残した。
- 履歴の対象・操作対応は語義上必要と判断したが、仕様に対応表がないため`confirmed`へ昇格せず`inferred`とした。
- system-wideなtarget architecture、データ移行、source of truth変更は発生していないため、Architecture Quality Strategyの適用対象外とした。
