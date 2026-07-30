/**
 * 起動エントリ。
 *
 * 現時点の役目は、実装計画 Step 3 の完了条件「初回起動でテンプレートが入る」を
 * ブラウザ上で確認できるようにすることに限る。画面の組み立て（仕様書12章）は
 * Step 4 以降で `src/ui/` へ実装し、このファイルは初期化とビュー切替の
 * 呼び出しへ縮める。
 *
 * サンプルテンプレートJSONの読み込みはここで行う。同一オリジンの相対パスであり、
 * 外部通信は発生しない（仕様書5.1.4、13章）。
 */

import { SCHEMA_VERSION } from './config.js';
import { bootstrap } from './app/bootstrap.js';
import { IndexedDbAdapter } from './storage/IndexedDbAdapter.js';

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

function setText(testId, value) {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (element !== null) {
    element.textContent = value;
  }
}

/**
 * 初期化結果を画面へ出す。Step 4 で `src/ui/` へ置き換える暫定表示。
 *
 * @param {{dataset: object, seededTemplateCount: number}} result
 */
function renderBootstrapResult({ dataset, seededTemplateCount }) {
  const status = document.getElementById('bootstrap-status');
  status.dataset.state = 'ready';
  setText('bootstrap-message', '保存基盤の初期化が完了しました。');
  setText('schema-version', String(dataset.settings.schemaVersion));
  setText('template-count', String(dataset.taskTemplates.length));
  setText('seeded-count', String(seededTemplateCount));

  const list = document.querySelector('[data-testid="template-list"]');
  list.textContent = '';
  const sorted = [...dataset.taskTemplates].sort((left, right) =>
    `${left.targetType}/${left.variant}`.localeCompare(`${right.targetType}/${right.variant}`, 'ja'),
  );
  for (const template of sorted) {
    const item = document.createElement('li');
    item.dataset.templateId = template.templateId;
    item.textContent =
      `${template.targetType} / ${template.variant} ` +
      `（版${template.version}、有効=${template.active}、作業項目${template.tasks.length}件）`;
    list.append(item);
  }
}

/**
 * 初期化に失敗した旨を画面へ出す（仕様書9.1 の成否表示の暫定版）。
 *
 * @param {unknown} error
 */
function renderBootstrapFailure(error) {
  const status = document.getElementById('bootstrap-status');
  status.dataset.state = 'error';
  const detail = error?.details?.length > 0 ? `\n${error.details.join('\n')}` : '';
  setText(
    'bootstrap-message',
    `保存基盤の初期化に失敗しました: ${error?.message ?? String(error)}${detail}`,
  );
}

async function main() {
  setText('schema-version', String(SCHEMA_VERSION));
  const adapter = new IndexedDbAdapter();
  try {
    const result = await bootstrap(adapter, {
      sampleTemplates: await loadSampleTemplates(),
    });
    renderBootstrapResult(result);
  } catch (error) {
    renderBootstrapFailure(error);
  }
}

main();
