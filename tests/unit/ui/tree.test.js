// @vitest-environment happy-dom

/**
 * 階層ツリーの単体テスト（仕様書12.1、12.2）。
 *
 * 並べ替え・展開・アーカイブ除外は、E2E で確かめると1件ごとに実ブラウザの起動が
 * 要る割に、実体は組み立ての分岐でしかない。ここで固定して E2E は導線の確認に
 * 絞る。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTree } from '../../../src/ui/tree.js';

/** 案件グループの雛形。 */
function projectGroup(overrides = {}) {
  return {
    projectGroupId: 'group-1',
    projectId: 'PJ-0001',
    targetType: '対象種別A',
    variant: '標準',
    totalQuantity: 100,
    createdAt: '2026-08-01T09:00:00+09:00',
    ...overrides,
  };
}

/** 実施回の雛形。 */
function workRun(overrides = {}) {
  return {
    runId: 'run-1',
    projectGroupId: 'group-1',
    workDate: '2026-08-01',
    runQuantity: 10,
    status: 'working',
    templateVersion: 1,
    createdAt: '2026-08-01T09:00:00+09:00',
    tasks: [],
    ...overrides,
  };
}

/** 作業項目実績の雛形。 */
function taskRecord(overrides = {}) {
  return {
    taskRecordId: 'task-1',
    taskDefinitionId: 'def-1',
    name: '受入確認',
    externalCode: 'X-100',
    order: 1,
    manuallyAdded: false,
    intervals: [],
    directEntries: [],
    ...overrides,
  };
}

/**
 * ツリーを描いて、その container と handlers を返す。
 *
 * @param {{projectGroups?: object[], workRuns?: object[], selection?: object}} state
 */
function renderTree(state = {}) {
  const container = document.createElement('div');
  const store = {
    getState: () => ({
      dataset: {
        projectGroups: state.projectGroups ?? [],
        workRuns: state.workRuns ?? [],
      },
      selection: state.selection ?? {
        projectGroupId: null,
        runId: null,
        taskRecordId: null,
      },
    }),
  };
  const handlers = {
    onSelectProject: vi.fn(),
    onSelectRun: vi.fn(),
    onSelectTask: vi.fn(),
    onCreateProject: vi.fn(),
  };

  const tree = createTree({ container, store, handlers });
  tree.render();
  return { container, tree, handlers };
}

/** `data-testid` で引く。 */
function all(container, testid) {
  return [...container.querySelectorAll(`[data-testid="${testid}"]`)];
}

function texts(container, testid) {
  return all(container, testid).map((node) => node.textContent);
}

describe('createTree() の描画', () => {
  it('案件が無ければ案内を出す', () => {
    const { container } = renderTree();

    expect(all(container, 'tree-empty')).toHaveLength(1);
    expect(all(container, 'tree')).toHaveLength(0);
  });

  it('案件を案件IDの昇順で並べる', () => {
    const { container } = renderTree({
      projectGroups: [
        projectGroup({ projectGroupId: 'g-c', projectId: 'PJ-0003' }),
        projectGroup({ projectGroupId: 'g-a', projectId: 'PJ-0001' }),
        projectGroup({ projectGroupId: 'g-b', projectId: 'PJ-0002' }),
      ],
    });

    expect(texts(container, 'tree-project')).toEqual([
      'PJ-0001残100',
      'PJ-0002残100',
      'PJ-0003残100',
    ]);
  });

  it('残数を出し、超過していれば強調する', () => {
    const { container } = renderTree({
      projectGroups: [projectGroup({ totalQuantity: 100 })],
      workRuns: [workRun({ runQuantity: 130 })],
    });

    const remaining = all(container, 'tree-remaining')[0];
    expect(remaining.textContent).toBe('残-30');
    expect(remaining.className).toContain('tree__meta--warn');
  });
});

describe('実施回の並びと採番', () => {
  const groups = [projectGroup()];

  it('作業日、次に作成日時の順に並べる', () => {
    const { container, tree } = renderTree({
      projectGroups: groups,
      workRuns: [
        workRun({ runId: 'r3', workDate: '2026-08-02', createdAt: '2026-08-02T09:00:00+09:00' }),
        workRun({ runId: 'r2', workDate: '2026-08-01', createdAt: '2026-08-01T15:00:00+09:00' }),
        workRun({ runId: 'r1', workDate: '2026-08-01', createdAt: '2026-08-01T09:00:00+09:00' }),
      ],
    });
    tree.expand({ projectGroupId: 'group-1' });
    tree.render();

    expect(texts(container, 'tree-run')).toEqual([
      '第1回 2026-08-01作業中',
      '第2回 2026-08-01作業中',
      '第3回 2026-08-02作業中',
    ]);
    expect(all(container, 'tree-run').map((node) => node.dataset.runId)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
  });

  it('アーカイブ済みの実施回は出さない（実装計画2.2(1)）', () => {
    const { container, tree } = renderTree({
      projectGroups: groups,
      workRuns: [
        workRun({ runId: 'r1', workDate: '2026-08-01' }),
        workRun({ runId: 'r2', workDate: '2026-08-02', status: 'archived' }),
        workRun({ runId: 'r3', workDate: '2026-08-03' }),
      ],
    });
    tree.expand({ projectGroupId: 'group-1' });
    tree.render();

    expect(all(container, 'tree-run').map((node) => node.dataset.runId)).toEqual(['r1', 'r3']);
  });

  it('アーカイブ済みも残数の計算には含める（仕様書8.2.5）', () => {
    const { container } = renderTree({
      projectGroups: [projectGroup({ totalQuantity: 100 })],
      workRuns: [
        workRun({ runId: 'r1', runQuantity: 30 }),
        workRun({ runId: 'r2', runQuantity: 20, status: 'archived' }),
      ],
    });

    // 非表示と集計対象は別物である。
    expect(texts(container, 'tree-remaining')).toEqual(['残50']);
  });

  it('実施回がアーカイブ済みだけなら折りたたみボタンを出さない', () => {
    const { container } = renderTree({
      projectGroups: groups,
      workRuns: [workRun({ status: 'archived' })],
    });

    expect(all(container, 'tree-toggle')).toHaveLength(0);
  });

  it('状態バッジを出す', () => {
    const { container, tree } = renderTree({
      projectGroups: groups,
      workRuns: [workRun({ status: 'transferred' })],
    });
    tree.expand({ projectGroupId: 'group-1' });
    tree.render();

    expect(all(container, 'tree-run')[0].textContent).toContain('転記済み');
  });
});

describe('展開と折りたたみ', () => {
  const state = {
    projectGroups: [projectGroup()],
    workRuns: [workRun({ tasks: [taskRecord()] })],
  };

  it('既定ではすべて折りたたむ', () => {
    const { container } = renderTree(state);

    expect(all(container, 'tree-run')).toHaveLength(0);
  });

  it('折りたたみボタンで開閉できる', () => {
    const { container } = renderTree(state);

    all(container, 'tree-toggle')[0].click();
    expect(all(container, 'tree-run')).toHaveLength(1);

    all(container, 'tree-toggle')[0].click();
    expect(all(container, 'tree-run')).toHaveLength(0);
  });

  it('expand() で案件と実施回をまとめて開ける', () => {
    const { container, tree } = renderTree(state);

    tree.expand({ projectGroupId: 'group-1', runId: 'run-1' });
    tree.render();

    expect(all(container, 'tree-run')).toHaveLength(1);
    expect(all(container, 'tree-task')).toHaveLength(1);
  });

  it('expand() へ null を渡しても余計な展開キーを作らない', () => {
    const { container, tree } = renderTree(state);

    tree.expand({ projectGroupId: null, runId: null });
    tree.render();

    expect(all(container, 'tree-run')).toHaveLength(0);
  });

  it('aria-expanded が開閉に追随する', () => {
    const { container } = renderTree(state);
    const toggle = all(container, 'tree-toggle')[0];
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();

    expect(all(container, 'tree-toggle')[0].getAttribute('aria-expanded')).toBe('true');
  });
});

describe('選択の表示', () => {
  const state = {
    projectGroups: [projectGroup()],
    workRuns: [workRun({ tasks: [taskRecord()] })],
  };

  it('選択中の案件を示す', () => {
    const { container } = renderTree({
      ...state,
      selection: { projectGroupId: 'group-1', runId: null, taskRecordId: null },
    });

    const node = all(container, 'tree-project')[0];
    expect(node.className).toContain('tree__label--selected');
    expect(node.getAttribute('aria-current')).toBe('true');
  });

  it('選択中の作業項目を示す', () => {
    const { container, tree } = renderTree({
      ...state,
      selection: { projectGroupId: 'group-1', runId: 'run-1', taskRecordId: 'task-1' },
    });
    tree.expand({ projectGroupId: 'group-1', runId: 'run-1' });
    tree.render();

    expect(all(container, 'tree-task')[0].getAttribute('aria-current')).toBe('true');
  });

  it('選択していないノードは aria-current を false にする', () => {
    const { container } = renderTree(state);

    expect(all(container, 'tree-project')[0].getAttribute('aria-current')).toBe('false');
  });
});

describe('作業項目の状態表示（仕様書7.2）', () => {
  /** 区間を1件持つ作業項目を作る。 */
  function withInterval(interval) {
    return taskRecord({ intervals: [interval] });
  }

  const cases = [
    ['未着手', taskRecord(), 'notStarted', '○'],
    [
      '作業中',
      withInterval({
        intervalId: 'i1',
        type: 'work',
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: null,
        participants: ['甲'],
      }),
      'working',
      '●',
    ],
    [
      '休憩中',
      withInterval({
        intervalId: 'i1',
        type: 'break',
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: null,
        participants: ['甲'],
      }),
      'onBreak',
      '◐',
    ],
    [
      '完了',
      withInterval({
        intervalId: 'i1',
        type: 'work',
        startAt: '2026-08-01T09:00:00+09:00',
        endAt: '2026-08-01T10:00:00+09:00',
        participants: ['甲'],
      }),
      'done',
      '✓',
    ],
  ];

  it.each(cases)('%s を記号と data-state で示す', (_label, task, state, mark) => {
    const { container, tree } = renderTree({
      projectGroups: [projectGroup()],
      workRuns: [workRun({ tasks: [task] })],
    });
    tree.expand({ projectGroupId: 'group-1', runId: 'run-1' });
    tree.render();

    const node = all(container, 'tree-task')[0];
    expect(node.dataset.state).toBe(state);
    expect(node.textContent).toContain(mark);
  });
});

describe('操作の通知', () => {
  let handlers;
  let container;

  beforeEach(() => {
    ({ container, handlers } = renderTree({
      projectGroups: [projectGroup()],
      workRuns: [workRun({ tasks: [taskRecord()] })],
    }));
  });

  it('新規案件を押すと通知する', () => {
    all(container, 'new-project')[0].click();

    expect(handlers.onCreateProject).toHaveBeenCalledTimes(1);
  });

  it('案件を押すと識別子を渡す', () => {
    all(container, 'tree-project')[0].click();

    expect(handlers.onSelectProject).toHaveBeenCalledWith('group-1');
  });

  it('実施回と作業項目を押すと識別子を渡す', () => {
    all(container, 'tree-toggle')[0].click();
    all(container, 'tree-run')[0].click();
    expect(handlers.onSelectRun).toHaveBeenCalledWith('run-1');

    all(container, 'tree-toggle')[1].click();
    all(container, 'tree-task')[0].click();
    expect(handlers.onSelectTask).toHaveBeenCalledWith('run-1', 'task-1');
  });
});

describe('キーボード操作（仕様書13章、レビュー指摘 D-18）', () => {
  /** フォーカスを扱うため、document.body へ実際に取り付けて描く。 */
  function renderAttached(state) {
    const rendered = renderTree(state);
    document.body.replaceChildren(rendered.container);
    return rendered;
  }

  /** 2案件・実施回・作業項目のあるツリー。 */
  function fixture() {
    return {
      projectGroups: [
        projectGroup({ projectGroupId: 'g-a', projectId: 'PJ-0001' }),
        projectGroup({ projectGroupId: 'g-b', projectId: 'PJ-0002' }),
      ],
      workRuns: [
        workRun({
          runId: 'r1',
          projectGroupId: 'g-a',
          tasks: [taskRecord({ taskRecordId: 't1' })],
        }),
      ],
    };
  }

  function press(target, key) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  it('Tab の停留所は1つだけである（roving tabindex）', () => {
    const { container } = renderAttached(fixture());

    const items = [...container.querySelectorAll('[role="treeitem"]')];
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    expect(items[0].tabIndex).toBe(0);
  });

  it('↑↓で表示中のノード間を移動する', () => {
    const { container } = renderAttached(fixture());
    const items = [...container.querySelectorAll('[role="treeitem"]')];
    items[0].focus();

    press(items[0], 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);

    press(items[1], 'ArrowUp');
    expect(document.activeElement).toBe(items[0]);
  });

  it('→で展開し、フォーカスを保つ', () => {
    const { container } = renderAttached(fixture());
    const project = container.querySelector('[data-testid="tree-project"]');
    project.focus();
    expect(project.getAttribute('aria-expanded')).toBe('false');

    press(project, 'ArrowRight');

    // 再描画で要素は作り直されるため、同じキーのノードで確かめる。
    const reopened = container.querySelector('[data-testid="tree-project"]');
    expect(reopened.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(reopened);
  });

  it('展開済みの→は最初の子へ移る', () => {
    const { container } = renderAttached(fixture());
    const project = container.querySelector('[data-testid="tree-project"]');
    project.focus();
    press(project, 'ArrowRight');

    press(document.activeElement, 'ArrowRight');

    expect(document.activeElement.dataset.testid).toBe('tree-run');
  });

  it('←で親ノードへ戻り、親の←は折りたたむ', () => {
    const { container } = renderAttached(fixture());
    const project = container.querySelector('[data-testid="tree-project"]');
    project.focus();
    press(project, 'ArrowRight');
    press(document.activeElement, 'ArrowRight');
    expect(document.activeElement.dataset.testid).toBe('tree-run');

    press(document.activeElement, 'ArrowLeft');
    expect(document.activeElement.dataset.testid).toBe('tree-project');

    press(document.activeElement, 'ArrowLeft');
    expect(
      container.querySelector('[data-testid="tree-project"]').getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('Home / End で先頭・末尾へ移る', () => {
    const { container } = renderAttached(fixture());
    const items = [...container.querySelectorAll('[role="treeitem"]')];
    items[0].focus();

    press(items[0], 'End');
    expect(document.activeElement).toBe(items[items.length - 1]);

    press(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items[0]);
  });

  it('折りたたみボタンは Tab の停留所にしない', () => {
    const { container } = renderAttached(fixture());

    for (const toggleButton of all(container, 'tree-toggle')) {
      expect(toggleButton.tabIndex).toBe(-1);
    }
  });

  it('作業項目の状態は読み上げ名に含める', () => {
    const { container, tree } = renderAttached(fixture());
    tree.expand({ projectGroupId: 'g-a', runId: 'r1' });
    tree.render();

    const task = container.querySelector('[data-testid="tree-task"]');
    expect(task.getAttribute('aria-label')).toBe('受入確認（未着手）');
    // 記号そのものは支援技術へ渡さない。
    expect(task.querySelector('.tree__mark').getAttribute('aria-hidden')).toBe('true');
  });

  it('tree / group / treeitem の役割が付く', () => {
    const { container, tree } = renderAttached(fixture());
    tree.expand({ projectGroupId: 'g-a', runId: 'r1' });
    tree.render();

    expect(container.querySelector('[role="tree"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="group"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(2);
  });

  describe('親子の所有関係（レビュー指摘 S11-2）', () => {
    it('すべての group が親 treeitem に所有される', () => {
      // treeitem は button なので子の ul を内側へ置けない。DOM では兄弟に
      // なるため、`aria-owns` が無いと階層として読まれない。
      const { container, tree } = renderAttached(fixture());
      tree.expand({ projectGroupId: 'g-a', runId: 'r1' });
      tree.render();

      const groups = [...container.querySelectorAll('[role="group"]')];
      expect(groups.length).toBe(2);
      for (const group of groups) {
        expect(group.id).not.toBe('');
        const owner = container.querySelector(`[role="treeitem"][aria-owns="${group.id}"]`);
        expect(owner).not.toBeNull();
      }
    });

    it('案件の group は案件ノードが、実施回の group は実施回ノードが所有する', () => {
      const { container, tree } = renderAttached(fixture());
      tree.expand({ projectGroupId: 'g-a', runId: 'r1' });
      tree.render();

      const project = container.querySelector('[data-testid="tree-project"]');
      const run = container.querySelector('[data-testid="tree-run"]');

      expect(document.getElementById(project.getAttribute('aria-owns'))).toContain(run);
      expect(
        document.getElementById(run.getAttribute('aria-owns')).querySelector('[data-testid="tree-task"]'),
      ).not.toBeNull();
    });

    it('畳んでいるノードは参照先の無い ID を指さない', () => {
      const { container } = renderAttached(fixture());

      const project = container.querySelector('[data-testid="tree-project"]');
      expect(project.getAttribute('aria-expanded')).toBe('false');
      expect(project.hasAttribute('aria-owns')).toBe(false);
    });
  });

  describe('現在地は1つだけ（レビュー指摘 S11-3）', () => {
    /** 作業項目まで選択した状態のツリー。 */
    function selectedTask() {
      const rendered = renderAttached({
        ...fixture(),
        selection: { projectGroupId: 'g-a', runId: 'r1', taskRecordId: 't1' },
      });
      rendered.tree.expand({ projectGroupId: 'g-a', runId: 'r1' });
      rendered.tree.render();
      return rendered;
    }

    it('作業項目を選ぶと current はその1件になる', () => {
      // 経路上の3つすべてが current になると、roving tabindex の停留所が
      // 最初に見つかる案件になり、表示中の詳細と食い違う。
      const { container } = selectedTask();

      const currents = [...container.querySelectorAll('[aria-current="true"]')];
      expect(currents).toHaveLength(1);
      expect(currents[0].dataset.testid).toBe('tree-task');
    });

    it('選択中の作業項目が Tab の停留所になる', () => {
      const { container } = selectedTask();

      const stops = [...container.querySelectorAll('[role="treeitem"]')].filter(
        (item) => item.tabIndex === 0,
      );
      expect(stops).toHaveLength(1);
      expect(stops[0].dataset.testid).toBe('tree-task');
    });

    it('実施回まで選んだ状態では実施回が current になる', () => {
      const rendered = renderAttached({
        ...fixture(),
        selection: { projectGroupId: 'g-a', runId: 'r1', taskRecordId: null },
      });
      rendered.tree.expand({ projectGroupId: 'g-a', runId: 'r1' });
      rendered.tree.render();

      const currents = [...rendered.container.querySelectorAll('[aria-current="true"]')];
      expect(currents).toHaveLength(1);
      expect(currents[0].dataset.testid).toBe('tree-run');
    });
  });

  describe('マウスで折りたたんだ後のフォーカス（レビュー指摘 S11-5）', () => {
    it('折りたたみボタンを押してもフォーカスがツリーに残る', () => {
      // ボタンは treeitem の兄弟なので focusin の経路に乗らず、再描画で自身も
      // 消える。放っておくとフォーカスが body へ落ち、矢印キーへ移れない。
      const { container } = renderAttached(fixture());
      const toggleButton = all(container, 'tree-toggle')[0];
      toggleButton.focus();

      toggleButton.click();

      expect(document.activeElement).toBe(
        container.querySelector('[data-testid="tree-project"]'),
      );
    });

    it('押した案件が Tab の停留所になる', () => {
      const { container } = renderAttached(fixture());
      const toggles = all(container, 'tree-toggle');
      toggles[toggles.length - 1].focus();

      toggles[toggles.length - 1].click();

      const stops = [...container.querySelectorAll('[role="treeitem"]')].filter(
        (item) => item.tabIndex === 0,
      );
      expect(stops).toHaveLength(1);
    });

    it('ツリー外にフォーカスがあるときは奪わない', () => {
      const { container } = renderAttached(fixture());
      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();

      all(container, 'tree-toggle')[0].click();

      expect(document.activeElement).toBe(outside);
    });
  });
});
