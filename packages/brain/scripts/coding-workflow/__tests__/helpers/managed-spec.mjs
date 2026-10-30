import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { initCommittableRepo, git } from './git.mjs';
import { renderIntent } from '../../lib/intent.mjs';
import { resolveAuthority } from '../../lib/authority-refs.mjs';

export const TASK = '11111111-2222-4333-8444-555555555555';
export const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
export function managedSpecFixture({ items = ['保留旧承诺并修改实现。'], rule = '<!-- rule: cw-safe -->\n不得丢弃已核实数据。\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-spec-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-spec-input-'));
  initCommittableRepo(root, path.join(tmp, 'hooks'));
  const refs = ['spec', 'rule', 'sample', 'implementation'].map(kind => ({ ref_id: kind, kind, path: kind + '.md', required: true }));
  const texts = { spec: '原规格', rule, sample: '样本预期：保留数据', implementation: '原实现' };
  for (const ref of refs) fs.writeFileSync(path.join(root, ref.path), texts[ref.kind]);
  fs.mkdirSync(path.join(root, 'docs/registry'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/registry/coding-workflow-authority.json'), JSON.stringify({ object_id: 'coding-workflow', refs }));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'test: frozen baseline');
  const revision = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'update-ref', 'refs/remotes/origin/main', revision);
  const authority = { object_id: 'coding-workflow', refs: refs.map(ref => ({ ...ref, revision, digest: hash(texts[ref.kind]) })) };
  const facts = resolveAuthority(root, authority.refs, { trustedSha: revision }).map(f => ({ ...f, object_id: authority.object_id }));
  const intent = renderIntent({ taskId: TASK, title: '旧规则继承', items, authorityFacts: facts });
  const sprint = path.join(root, 'sprints/s1'); fs.mkdirSync(sprint, { recursive: true });
  fs.writeFileSync(path.join(sprint, '01-intent.md'), intent);
  const input = { task_id: TASK, run_tag: 'baseline-test', worktree: root, sprint_dir: 'sprints/s1', intent_ids: items.map((_, i) => `I-${i + 1}`), intent_sha256: hash(intent), authority_required: true, authority, trusted_repo: root, authority_index_sha: revision, initial_base_sha: revision };
  const links = { reason: '保持原业务承诺', intent_ids: ['I-1'], spec_ids: ['S-1'], qa_ids: ['Q-1'], approval_refs: [] };
  const plan = { version: 1, rules: [{ ref_id: 'rule', rule_id: 'cw-safe', action: 'keep', ...links }], materials: refs.map(ref => ({ ref_id: ref.ref_id, path: ref.path, action: 'keep', ...links, verification: '实际运行旧规则回归并读取结果' })) };
  return { root, tmp, sprint, input, intent, plan, clean: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); } };
}
export function specText(plan, task = TASK) {
  return `---\ntask_id: ${task}\nstep: spec\nupstream: ["01-intent.md#I-1"]\n---\n# 规格\n### S-1\n保持已有承诺，更新实现。\n## QA 场景\n### Q-1\n对应: I-1\n操作: 用户处理已有记录\n期望: 数据完整保留\n## 未覆盖真实链路\n无：隔离软件调用链验收\n${plan ? '## 旧规则与材料计划\n```json\n' + JSON.stringify(plan) + '\n```\n' : ''}`;
}
