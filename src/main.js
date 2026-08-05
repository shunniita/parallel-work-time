/**
 * 起動エントリ。初期化と画面の結線のみを持つ。
 *
 * 流れは次のとおり。
 *
 *   サンプルJSON読込 → bootstrap（初期化・初回投入）→ ストア生成
 *   → 骨格の描画 → ツリーと詳細ペインの描画
 *
 * サンプルテンプレートJSONの読み込みはここで行う。同一オリジンの相対パスであり、
 * 外部通信は発生しない（仕様書5.1.4、13章）。
 *
 * 専用ルーティングは持たず、単一ページ内のビュー切替で画面を表現する（12.2）。
 * 実装計画 Step 6 PR-B1 の時点で動くのは、テンプレート・案件登録・案件詳細・
 * 実施回詳細・作業項目詳細である。集計・アーカイブ・設定は Step 8 以降。
 *
 * ## ビューの登録表（レビュー指摘 B-6）
 *
 * 画面の対応は `if` 連鎖ではなく `VIEW → {render, reset}` の表で持つ。案件画面
 * だけは選択の深さで内容が変わるため（案件 / 実施回 / 作業項目）、その中で
 * もう一段だけ分岐する。未登録のビューは案件詳細へ落とさず、未実装として
 * 明示する。
 *
 * 再描画はここが持つストア購読1本に集約する（規約は `src/app/store.js` 参照）。
 * `store.setState()` を呼んだ側は `render()` を書かない。書き忘れが「クリック
 * しても何も起きない」「左ツリーだけ古い値が残る」という形で表に出るため、
 * 更新と描画を1つの経路へまとめる。
 */

import { SCHEMA_VERSION } from './config.js';
import { bootstrap } from './app/bootstrap.js';
import { createStore } from './app/store.js';
import { createPersistence } from './app/persistence.js';
import {
  createTemplate,
  reviseTemplateAction,
} from './app/actions/templateActions.js';
import {
  createProjectGroup,
  createWorkRun,
  updateRunQuantity,
  updateTotalQuantity,
} from './app/actions/projectActions.js';
import {
  addIntervalManually,
  deleteInterval,
  previewIntervalDeletion,
  recordBreak,
  recordFinish,
  recordParticipantChange,
  recordResume,
  recordStart,
  updateInterval,
} from './app/actions/intervalActions.js';
import {
  createDirectEntry,
  deleteDirectEntry,
  previewDirectEntryDeletion,
  updateDirectEntry,
} from './app/actions/directEntryActions.js';
import {
  markAggregated,
  markTransferred,
  previewStatusChange,
  reopenRun,
  revertTransfer,
} from './app/actions/transferActions.js';
import { IndexedDbAdapter } from './storage/IndexedDbAdapter.js';
import { VIEW, renderShell } from './ui/shell.js';
import { renderStatusBar } from './ui/statusBar.js';
import { createTree } from './ui/tree.js';
import { createTemplateView } from './ui/views/templateView.js';
import { createProjectFormView } from './ui/views/projectFormView.js';
import { createProjectView } from './ui/views/projectView.js';
import { createRunView } from './ui/views/runView.js';
import { createTaskDetailView } from './ui/views/taskDetailView.js';
import { createSummaryView } from './ui/views/summaryView.js';
import { createPlaceholderView } from './ui/views/placeholderView.js';
import { el, replaceChildren } from './ui/dom.js';

/** サンプルテンプレートの配置（仕様書8.1.6）。 */
const SAMPLE_TEMPLATES_URL = 'data/sample-task-templates.json';

/**
 * サンプルテンプレートJSONを読み込む。
 *
 * 読めなくても起動自体は続ける。テンプレートは画面から登録できるため
 * （仕様書8.1.1）、初期投入の失敗は致命的ではない。
 *
 * @returns {Promise<object|null>}
 */
async function loadSampleTemplates() {
  try {
    const response = await fetch(SAMPLE_TEMPLATES_URL);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * 起動に失敗した旨を出す。骨格を描く前に落ちた場合の受け皿。
 *
 * @param {HTMLElement} root
 * @param {unknown} error
 */
function renderBootFailure(root, error) {
  const detail = error?.details?.length > 0 ? error.details.join(' / ') : '';
  replaceChildren(root, [
    el('div', { class: 'errors', role: 'alert', dataset: { testid: 'boot-error' } }, [
      el('p', { class: 'errors__title', text: '起動できませんでした' }),
      el('p', { text: error?.message ?? String(error) }),
      detail !== '' && el('p', { text: detail }),
    ]),
  ]);
}

async function main() {
  const root = document.getElementById('app');
  const adapter = new IndexedDbAdapter();

  let dataset;
  try {
    ({ dataset } = await bootstrap(adapter, {
      sampleTemplates: await loadSampleTemplates(),
    }));
  } catch (error) {
    renderBootFailure(root, error);
    return;
  }

  const store = createStore({
    dataset,
    // 案件が無い状態ではテンプレート画面から始める。あるなら案件一覧側へ。
    view: dataset.projectGroups.length === 0 ? VIEW.TEMPLATES : VIEW.PROJECTS,
    /** 左ツリーの選択。詳細ペインの表示内容を決める。 */
    selection: { projectGroupId: null, runId: null, taskRecordId: null },
  });
  const persistence = createPersistence(adapter);

  const shell = renderShell(root, { onNavigate: navigate });
  const statusBar = renderStatusBar(shell.statusBar, { schemaVersion: SCHEMA_VERSION });
  statusBar.update(persistence.getStatus());
  persistence.subscribe((status) => statusBar.update(status));

  const deps = { adapter, persistence };

  /**
   * アクションの結果でストアを更新する薄い包み。
   *
   * 画面側は保存後のデータセットを自分で流し込まなくてよい。`setState` が購読を
   * 通して全体を描き直すため、左ツリーの残数のように呼び出し元のビュー外にある
   * 表示もここで一緒に更新される。
   *
   * @param {Function} action
   */
  function wrap(action) {
    return async (...args) => {
      const result = await action(deps, ...args);
      // 書き込みは成功したが読み直しに失敗した場合は null が返る。古い内容で
      // 上書きせず、保存状態表示の注記に任せる（`persistence.run` 参照）。
      if (result.dataset !== null) {
        store.setState({ dataset: result.dataset });
      }
      return result;
    };
  }

  /**
   * 区間の記録・修正・削除（仕様書8.4、11章）。作業項目詳細と実施回詳細の行から
   * 呼ぶ。行は開始・休憩・再開・終了・参加者変更だけを使い、区間追加・編集・
   * 削除は作業項目詳細だけが使う（`taskDetailView.js`）。
   *
   * `previewIntervalDeletion` は保存を行わない純関数のため、`wrap()` を通さず
   * そのまま渡す（`deps` を引数に取らない）。
   */
  const intervalActions = {
    recordStart: wrap(recordStart),
    recordBreak: wrap(recordBreak),
    recordResume: wrap(recordResume),
    recordFinish: wrap(recordFinish),
    recordParticipantChange: wrap(recordParticipantChange),
    addIntervalManually: wrap(addIntervalManually),
    updateInterval: wrap(updateInterval),
    deleteInterval: wrap(deleteInterval),
    previewIntervalDeletion,
  };

  /**
   * 直接入力の追加・修正・削除（仕様書8.5、11章）。作業項目詳細だけが使う。
   * 実施回詳細の行には出さない。備考が必須で、行の中へ収めるには入力が多い。
   *
   * `previewDirectEntryDeletion` は保存を行わない純関数のため、`wrap()` を
   * 通さずそのまま渡す（`deps` を引数に取らない）。
   */
  const directEntryActions = {
    createDirectEntry: wrap(createDirectEntry),
    updateDirectEntry: wrap(updateDirectEntry),
    deleteDirectEntry: wrap(deleteDirectEntry),
    previewDirectEntryDeletion,
  };

  const tree = createTree({
    container: shell.treePane,
    store,
    handlers: {
      onSelectProject: selectProject,
      onSelectRun: selectRun,
      onSelectTask: (runId, taskRecordId) => {
        const run = store
          .getState()
          .dataset.workRuns.find((candidate) => candidate.runId === runId);
        selectTask(run?.projectGroupId ?? null, runId, taskRecordId);
      },
      onCreateProject: openProjectForm,
    },
  });

  const templateView = createTemplateView({
    container: shell.detailPane,
    store,
    actions: {
      createTemplate: wrap(createTemplate),
      reviseTemplate: wrap(reviseTemplateAction),
    },
  });

  const projectFormView = createProjectFormView({
    container: shell.detailPane,
    store,
    actions: { createProjectGroup: wrap(createProjectGroup) },
    handlers: {
      onCreated: (projectGroup) => {
        tree.expand({ projectGroupId: projectGroup.projectGroupId });
        selectProject(projectGroup.projectGroupId);
        // 登録できたらそのまま実施回を作れるようにする。案件詳細を出したうえで
        // フォームを開くため、ここだけはビュー内部の状態変更として描き直す。
        projectView.openRunForm();
        projectView.render();
      },
      // 既存案件と衝突したときの「この案件へ実施回を追加」導線（仕様書8.2.6）。
      onOpenExisting: (projectGroupId) => {
        tree.expand({ projectGroupId });
        selectProject(projectGroupId);
        projectView.openRunForm();
        projectView.render();
      },
      onCancel: () => {
        store.setState({ view: VIEW.PROJECTS });
      },
    },
  });

  const projectView = createProjectView({
    container: shell.detailPane,
    store,
    actions: {
      createWorkRun: wrap(createWorkRun),
      updateTotalQuantity: wrap(updateTotalQuantity),
      updateRunQuantity: wrap(updateRunQuantity),
    },
    handlers: { onSelectRun: selectRun },
  });

  const runView = createRunView({
    container: shell.detailPane,
    store,
    actions: intervalActions,
    handlers: {
      onOpenTask: (taskRecordId) => {
        const { selection } = store.getState();
        selectTask(selection.projectGroupId, selection.runId, taskRecordId);
      },
      onSelectProject: selectProject,
    },
  });

  const taskDetailView = createTaskDetailView({
    container: shell.detailPane,
    store,
    actions: { ...intervalActions, ...directEntryActions },
    handlers: { onBackToRun: selectRun },
  });

  /**
   * 集計・転記（仕様書8.7、7.1）。左ツリーで選んだ実施回を対象にする。
   *
   * `previewStatusChange` は保存を行わない純関数のため、`wrap()` を通さず
   * そのまま渡す（`deps` を引数に取らない）。
   */
  const summaryView = createSummaryView({
    container: shell.detailPane,
    store,
    actions: {
      markAggregated: wrap(markAggregated),
      reopenRun: wrap(reopenRun),
      markTransferred: wrap(markTransferred),
      revertTransfer: wrap(revertTransfer),
      previewStatusChange,
    },
    handlers: {
      // 集計中に記録の誤りへ気づいたとき、実施回詳細へ移れるようにする。
      onSelectRun: (runId) => selectRun(runId),
    },
  });

  /**
   * 案件画面の中身を描く。
   *
   * 選択の深さで内容が変わる。作業項目まで選んでいれば作業項目詳細、実施回まで
   * なら実施回詳細、案件だけなら案件詳細である。
   */
  function renderProjectsView() {
    const { selection } = store.getState();
    if (selection.taskRecordId !== null) {
      taskDetailView.render();
      return;
    }
    if (selection.runId !== null) {
      runView.render();
      return;
    }
    projectView.render();
  }

  /** 案件画面へ入り直すときの後始末。下書きと開きかけの入力を残さない。 */
  function resetProjectsView() {
    projectFormView.reset();
    projectView.reset();
    runView.reset();
    taskDetailView.reset();
  }

  /**
   * ビューの登録表（レビュー指摘 B-6）。
   *
   * `reset` は画面へ入り直すときに呼ぶ。持たないビューは省略できる。
   */
  const views = new Map([
    [VIEW.TEMPLATES, { render: () => templateView.render() }],
    [VIEW.PROJECT_FORM, projectFormView],
    [VIEW.PROJECTS, { render: renderProjectsView, reset: resetProjectsView }],
    [VIEW.SUMMARY, summaryView],
    [
      VIEW.ARCHIVE,
      createPlaceholderView({
        container: shell.detailPane,
        title: 'アーカイブ',
        note: '転記済み・削除候補の一覧は実装計画 Step 10 で作ります。',
      }),
    ],
    [
      VIEW.SETTINGS,
      createPlaceholderView({
        container: shell.detailPane,
        title: '設定・バックアップ',
        note: '保持期間・しきい値・JSON入出力は実装計画 Step 9 で作ります。',
      }),
    ],
  ]);

  /** 登録の無いビュー名が来た場合の受け皿。案件詳細へは落とさない。 */
  const unknownView = createPlaceholderView({
    container: shell.detailPane,
    title: '画面が見つかりません',
    note: '指定された画面は存在しません。ヘッダーから選び直してください。',
    testid: 'unknown-view',
  });

  /**
   * 画面を切り替える。
   *
   * @param {string} view
   */
  function navigate(view) {
    views.get(view)?.reset?.();
    store.setState({ view });
  }

  function openProjectForm() {
    projectFormView.reset();
    store.setState({ view: VIEW.PROJECT_FORM });
  }

  function selectProject(projectGroupId) {
    projectView.reset();
    runView.reset();
    taskDetailView.reset();
    store.setState({
      view: VIEW.PROJECTS,
      selection: { projectGroupId, runId: null, taskRecordId: null },
    });
  }

  function selectRun(runId) {
    const run = store.getState().dataset.workRuns.find((candidate) => candidate.runId === runId);
    projectView.reset();
    runView.reset();
    taskDetailView.reset();
    tree.expand({ projectGroupId: run?.projectGroupId, runId });
    store.setState({
      view: VIEW.PROJECTS,
      selection: {
        projectGroupId: run?.projectGroupId ?? null,
        runId,
        taskRecordId: null,
      },
    });
  }

  /**
   * 作業項目詳細を開く（仕様書12.2）。
   *
   * 開きかけの操作フォームは持ち越さない。別の作業項目に対する入力が、選び直した
   * 先でそのまま開いていると誤記録につながる。
   *
   * @param {string|null} projectGroupId
   * @param {string} runId
   * @param {string} taskRecordId
   */
  function selectTask(projectGroupId, runId, taskRecordId) {
    runView.reset();
    taskDetailView.reset();
    // 選んだ作業項目が左ツリー側でも見えるように実施回を開いておく。
    tree.expand({ projectGroupId, runId });
    store.setState({
      view: VIEW.PROJECTS,
      selection: { projectGroupId, runId, taskRecordId },
    });
  }

  /**
   * 詳細ペインを描く。
   *
   * 登録表から選ぶ。案件画面の中の分岐は `renderProjectsView` が持つ。
   */
  function renderDetail() {
    const { view } = store.getState();
    (views.get(view) ?? unknownView).render();
  }

  function render() {
    shell.setActiveView(store.getState().view);
    tree.render();
    renderDetail();
  }

  // 再描画の唯一のきっかけ。`setState` を呼べば必ずここを通るため、更新した側が
  // 描画を書き忘れても表示が取り残されることがない。
  store.subscribe(render);
  render();
}

main();
