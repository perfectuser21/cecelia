import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildExistingOpsSources } from '../existing-ops-source.js';

const revision = '0464135bfdc707530513fda1f8f6bf278ffd173e';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], { cwd: root, encoding: 'utf8' }).replace(/\0$/, '').split('\0');
const sourceCache = new Map();
const readGit = path => execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const read = async path => { if (!sourceCache.has(path)) sourceCache.set(path, readGit(path)); return sourceCache.get(path); };
const build = overrides => buildExistingOpsSources({ scope: 'cecelia', repo: 'perfectuser21/cecelia', revision, paths, readSource: read, ...overrides });

describe('真实工厂旧消费者来源，独立于可执行完整Workflow', () => {
  it('固定main实际字节证明两个旧活动，其余六引用继续UNKNOWN且不能成为执行定义', async () => {
    const result = await build();
    expect(result.consumers.map(c => c.activity_id).sort()).toEqual(['0466016e-6d9f-4325-aeb4-d8bc70424a48', '0ab79a73-1ec3-4ddc-bb88-1433568ae2e2'].sort());
    expect(result.consumers.every(c => c.status === 'verified' && c.definition_scope === 'consumer_evidence')).toBe(true);
    expect(result.workflows).toHaveLength(2);
    expect(result.workflows.every(w => w.coverage.status === 'unknown' && w.coverage.unverified_reference_ids.length === 3 && w.executable === false)).toBe(true);
    expect(result.consumers.find(c => c.activity_id.startsWith('0ab79')).bindings.some(b => b.path === 'packages/brain/migrations/535_coding_workflow_runner_executor_kind.sql')).toBe(true);
    expect(result.consumers.find(c => c.activity_id.startsWith('0ab79')).bindings.some(b => b.path.includes('/rollback/'))).toBe(false);
    expect(result.consumers.every(c => c.bindings.every(b => b.revision === revision && /^[a-f0-9]{64}$/.test(b.content_sha256) && !b.path.includes('*')))).toBe(true);
  });
  it('生产migrate输入发现逻辑消失则生产活动UNKNOWN，不能仅凭SQL存在认领', async () => {
    const result = await build({ readSource: async path => path === 'packages/brain/src/migrate.js' ? 'export function runMigrations() {}' : read(path) });
    const consumer = result.consumers.find(c => c.activity_id.startsWith('0ab79'));
    expect(consumer.status).toBe('unknown');
    expect(consumer.bindings).toEqual([]);
    expect(consumer.gaps.some(g => g.code === 'migration_input_unproven')).toBe(true);
  });
  it('夜间真实run命令缺失不允许凭workflow名字或测试文件存在假认领', async () => {
    const result = await build({ readSource: async path => path === '.github/workflows/nightly-regression.yml' ? 'name: Nightly\njobs: {}' : read(path) });
    expect(result.consumers.find(c => c.activity_id.startsWith('046601')).status).toBe('unknown');
  });
  it('任何固定来源缺失保持UNKNOWN，不吞异常伪通过', async () => {
    const result = await build({ readSource: async path => { if (path === 'scripts/deploy-local.sh') throw Error('source missing'); return read(path); } });
    expect(result.consumers.find(c => c.activity_id.startsWith('0ab79')).status).toBe('unknown');
    expect(result.consumers.find(c => c.activity_id.startsWith('0ab79')).gaps).toContainEqual({ code: 'source_unavailable', path: 'scripts/deploy-local.sh' });
  });
  it('注释或字符串中保留旧迁移调用不构成实际输入关系', async () => {
    for (const wrap of [text => `/*\n${text}\n*/\nexport function runMigrations() {}`, text => `const legacy = ${JSON.stringify(text)};\nexport function runMigrations() {}`]) {
      const result = await build({ readSource: async path => path === 'packages/brain/src/migrate.js' ? wrap(await read(path)) : read(path) });
      expect(result.consumers.find(c => c.activity_id.startsWith('0ab79')).status).toBe('unknown');
    }
  });
  it('非工厂scope、跨repo、宽路径与非固定SHA拒绝', async () => {
    for (const override of [{ scope: 'cecelia-kr' }, { repo: 'perfectuser21/zenithjoy-workspace' }, { revision: 'main' }, { paths: [...paths, 'packages/brain/migrations/*.sql'] }])
      await expect(build(override)).rejects.toThrow(/OPS_SOURCE_INPUT_INVALID/);
  });
});
