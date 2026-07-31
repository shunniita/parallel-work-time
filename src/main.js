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
 * 実装計画 Step 5 の時点で動くのは、テンプレート・案件登録・案件詳細・
 * 実施回詳細（閲覧）である。集計・アーカイブ・設定は Step 8 以降。
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
import { IndexedDbAdapter } from './storage/IndexedDbAdapter.js';
import { VIEW, renderShell } from './ui/shell.js';
import { renderStatusBar } from './ui/statusBar.js';
import { createTree } from './ui/tree.js';
import { createTemplateView } from './ui/views/templateView.js';
import { createProjectFormView } from './ui/views/projectFormView.js';
import { createProjectView } from './ui/views/projectView.js';
import { createRunView } from './ui/views/runView.js';
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
   * 画面側は保存後のデータセットを自分で流し込まなくてよい。
   *
   * @param {Function} action
   */
  function wrap(action) {
    return async (...args) => {
      const result = await action(deps, ...args);
      store.setState({ dataset: result.dataset });
      return result;
    };
  }

  const tree = createTree({
    container: shell.treePane,
    store,
    handlers: {
      onSelectProject: selectProject,
      onSelectRun: selectRun,
      onSelectTask: (runId, taskRecordId) => {
        // 作業項目詳細は Step 6 で実装する。今は実施回詳細を開くところまで。
        const run = store
          .getState()
          .dataset.workRuns.find((candidate) => candidate.runId === runId);
        store.setState({
          view: VIEW.PROJECTS,
          selection: {
            projectGroupId: run?.projectGroupId ?? null,
            runId,
            taskRecordId,
          },
        });
        render();
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
        // 登録できたらそのまま実施回を作れるようにする。
        projectView.openRunForm();
        renderDetail();
      },
      // 既存案件と衝突したときの「この案件へ実施回を追加」導線（仕様書8.2.6）。
      onOpenExisting: (projectGroupId) => {
        tree.expand({ projectGroupId });
        selectProject(projectGroupId);
        projectView.openRunForm();
        renderDetail();
      },
      onCancel: () => {
        store.setState({ view: VIEW.PROJECTS });
        render();
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
    handlers: {
      onSelectTask: (taskRecordId) => {
        store.setState({ selection: { ...store.getState().selection, taskRecordId } });
      },
      onSelectProject: selectProject,
    },
  });

  /**
   * 画面を切り替える。
   *
   * @param {string} view
   */
  function navigate(view) {
    if (view === VIEW.PROJECTS) {
      projectFormView.reset();
      projectView.reset();
    }
    store.setState({ view });
    render();
  }

  function openProjectForm() {
    projectFormView.reset();
    store.setState({ view: VIEW.PROJECT_FORM });
    render();
  }

  function selectProject(projectGroupId) {
    projectView.reset();
    store.setState({
      view: VIEW.PROJECTS,
      selection: { projectGroupId, runId: null, taskRecordId: null },
    });
    render();
  }

  function selectRun(runId) {
    const run = store.getState().dataset.workRuns.find((candidate) => candidate.runId === runId);
    projectView.reset();
    tree.expand({ projectGroupId: run?.projectGroupId, runId });
    store.setState({
      view: VIEW.PROJECTS,
      selection: {
        projectGroupId: run?.projectGroupId ?? null,
        runId,
        taskRecordId: null,
      },
    });
    render();
  }

  /**
   * 詳細ペインを描く。
   *
   * 案件画面では選択の深さで内容が変わる。実施回を選んでいれば実施回詳細、
   * 案件だけなら案件詳細、どちらも無ければ案内を出す。
   */
  function renderDetail() {
    const { view, selection } = store.getState();
    if (view === VIEW.TEMPLATES) {
      templateView.render();
      return;
    }
    if (view === VIEW.PROJECT_FORM) {
      projectFormView.render();
      return;
    }
    if (selection.runId !== null) {
      runView.render();
      return;
    }
    projectView.render();
  }

  function render() {
    shell.setActiveView(store.getState().view);
    tree.render();
    renderDetail();
  }

  render();
}

main();
