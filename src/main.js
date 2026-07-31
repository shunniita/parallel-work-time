/**
 * 起動エントリ。初期化と画面の結線のみを持つ。
 *
 * 流れは次のとおり。
 *
 *   サンプルJSON読込 → bootstrap（初期化・初回投入）→ ストア生成
 *   → 骨格の描画 → 画面の描画
 *
 * サンプルテンプレートJSONの読み込みはここで行う。同一オリジンの相対パスであり、
 * 外部通信は発生しない（仕様書5.1.4、13章）。
 *
 * 画面は実装計画 Step 4 の時点でテンプレート画面のみ。Step 5 以降でヘッダーの
 * 各画面と左ツリーを埋めていく。
 */

import { SCHEMA_VERSION } from './config.js';
import { bootstrap } from './app/bootstrap.js';
import { createStore } from './app/store.js';
import { createPersistence } from './app/persistence.js';
import {
  createTemplate,
  reviseTemplateAction,
} from './app/actions/templateActions.js';
import { IndexedDbAdapter } from './storage/IndexedDbAdapter.js';
import { VIEW, renderShell, renderTreePlaceholder } from './ui/shell.js';
import { renderStatusBar } from './ui/statusBar.js';
import { createTemplateView } from './ui/views/templateView.js';
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

  const store = createStore({ dataset, view: VIEW.TEMPLATES });
  const persistence = createPersistence(adapter);

  const shell = renderShell(root, {
    onNavigate: (view) => {
      store.setState({ view });
      shell.setActiveView(view);
    },
  });
  shell.setActiveView(VIEW.TEMPLATES);

  const statusBar = renderStatusBar(shell.statusBar, { schemaVersion: SCHEMA_VERSION });
  statusBar.update(persistence.getStatus());
  persistence.subscribe((status) => statusBar.update(status));

  replaceChildren(shell.treePane, [renderTreePlaceholder()]);

  // アクションへはストアの更新まで含めて渡す。画面側は保存後のデータセットを
  // 自分で流し込まなくてよい。
  const deps = { adapter, persistence };
  const templateView = createTemplateView({
    container: shell.detailPane,
    store,
    actions: {
      createTemplate: async (draft) => {
        const result = await createTemplate(deps, draft);
        store.setState({ dataset: result.dataset });
        return result;
      },
      reviseTemplate: async (templateId, draft) => {
        const result = await reviseTemplateAction(deps, templateId, draft);
        store.setState({ dataset: result.dataset });
        return result;
      },
    },
  });

  templateView.render();
}

main();
