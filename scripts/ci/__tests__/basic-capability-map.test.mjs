import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// 执行实际生成器的 Python 正文，只替换 SQLite 读取边界；不运行 Docker 或同步脚本。
test('旧采集工作流不再生成能力映射，共享映射保留', () => {
  const script = readFileSync('packages/workflows/scripts/sync-capability-map.sh', 'utf8');
  const source = script.match(/python << 'PYTHON'\n([\s\S]*?)\nPYTHON/)[1];
  const rows = [
    ['自媒体', '[Flow] 数据采集调度器', 'retired-scheduler', 1],
    ['自媒体', '[Unit] 抖音数据爬取', 'retired-unit', 1],
    ['自媒体', '[Flow] 内容发布', 'publish', 0],
    ['Cecelia', '[Flow] 任务启动器', 'launcher', 1],
    ['基础工具', '[Unit] 健康检查', 'health', 1],
  ];
  const fixture = `import sqlite3\nclass Fixture:\n    def cursor(self): return self\n    def execute(self, query): pass\n    def fetchall(self): return ${JSON.stringify(rows)}\n    def close(self): pass\nsqlite3.connect = lambda *args: Fixture()\n`;
  const result = spawnSync('python3', ['-c', fixture + source], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const { capabilities } = JSON.parse(result.stdout);
  assert.deepEqual(capabilities.map(item => item.name).sort(),
    ['Cecelia 自动化', '内容发布', '服务器维护']);
  const workflows = capabilities.flatMap(item => item.workflows);
  assert.deepEqual(workflows.map(item => item.n8n_id).sort(), ['health', 'launcher', 'publish']);
  assert.equal(workflows.find(item => item.n8n_id === 'publish').active, false);
  assert.equal(workflows.find(item => item.n8n_id === 'health').role, 'worker');
  assert.equal(workflows.find(item => item.n8n_id === 'launcher').role, 'orchestrator');
});
