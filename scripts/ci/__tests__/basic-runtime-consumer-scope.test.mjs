import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planChecks} from '../basic-scope.mjs';

const components = rows => [...new Set(rows.map(row => row.component))];
const shared = ['brain-unit', 'brain-integration', 'image', 'api', 'api-integration', 'ops', 'scripts'];

test('说明书直接Markdown是Brain和镜像运行输入，先于普通文档豁免', () => {
  for (const path of ['docs/instruction-book/features/topics-api.md',
    'docs/instruction-book/features/system-registry.md',
    'docs/instruction-book/skills/dev.md', 'docs/instruction-book/features/README.md']) {
    const rows = planChecks([path]);
    assert.deepEqual(components(rows), ['brain-unit', 'image', 'scripts'], path);
    assert.deepEqual(rows.filter(row => row.component === 'brain-unit').map(row => row.shard), [1, 2, 3, 4, 5, 6]);
  }
});

test('Dashboard共享API features触发前端，服务端和独立组件保持范围', () => {
  for (const path of ['apps/api/features/knowledge/pages/KnowledgeModules.tsx',
    'apps/api/features/knowledge/index.ts', 'apps/api/features/shared/Button.tsx']) {
    assert.deepEqual(components(planChecks([path])), [...shared.slice(0, -2), 'dashboard', 'ops', 'scripts'], path);
  }
  assert.deepEqual(components(planChecks(['apps/api/src/index.ts'])), shared);
  assert.deepEqual(components(planChecks(['apps/android-agent/app/Agent.kt'])), ['android', 'scripts']);
  assert.deepEqual(components(planChecks(['packages/mcp-readonly/server.js'])), ['mcp', 'scripts']);
});

test('普通历史文档和非递归说明书文件仍只运行scripts', () => {
  for (const path of ['README.md', 'docs/history/plan.md', 'docs/instruction-book/README.md',
    'docs/instruction-book/features/nested/plan.md', 'docs/instruction-book/features/topics-api.txt',
    'docs/instruction-book/features/topics-api.MD', 'sprints/old/plan.md']) {
    assert.deepEqual(planChecks([path]), [{component: 'scripts'}], path);
  }
});
