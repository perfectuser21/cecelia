// lib/repo-profile.mjs（C6）：活动层与提示词按仓库参数化——repos.json 条目经 envelope.input.repo_profile / cfg.repoProfile 传入，
// 缺省 = 默认仓（cecelia），旧信封 / 旧调用方行为不变。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileOf, defaultProfile, qaMode, productionPatterns, repoRules, qaSmokeOf, PRECHECK_SETS } from '../lib/repo-profile.mjs';
import { loadPrompt } from '../lib/claude.mjs';
import { PRODUCTION_TARGET_RE } from '../lib/qa-report.mjs';
import { QA_SMOKE_DIR } from '../lib/qa-smoke.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(HERE, '..');
const REPOS = JSON.parse(fs.readFileSync(path.join(WORKFLOW, 'repos.json'), 'utf8')).repos;
const cecelia = REPOS.find((r) => r.key === 'cecelia');
const zj = REPOS.find((r) => r.key === 'zenithjoy-workspace');

describe('profileOf / defaultProfile', () => {
  it('没传或传了不像条目的东西 → 默认仓 cecelia；传了条目原样用', () => {
    expect(defaultProfile().key).toBe('cecelia');
    expect(profileOf(undefined).key).toBe('cecelia');
    expect(profileOf(null).key).toBe('cecelia');
    expect(profileOf({}).key).toBe('cecelia');
    expect(profileOf(zj).key).toBe('zenithjoy-workspace');
  });

  it('QA 模式：cecelia = brain_preview，zenithjoy = local（PR worktree 内黑盒）', () => {
    expect(qaMode(undefined)).toBe('brain_preview');
    expect(qaMode(cecelia)).toBe('brain_preview');
    expect(qaMode(zj)).toBe('local');
  });

  it('回归 smoke 目录：cecelia 照旧 packages/brain/scripts/smoke；zenithjoy 第一阶段不固化（null）', () => {
    expect(qaSmokeOf(undefined).dir).toBe(QA_SMOKE_DIR);
    expect(qaSmokeOf(cecelia).dir).toBe(QA_SMOKE_DIR);
    expect(qaSmokeOf(zj)).toBeNull();
  });
});

describe('productionPatterns：本仓生产 ∪ 默认仓生产（MMV 本机 5221 永远是 cecelia 生产 Brain）', () => {
  const re = (p) => new RegExp(productionPatterns(p).join('|'));
  it('cecelia 口径不变（与 PRODUCTION_TARGET_RE 等价）', () => {
    expect(re(cecelia).source).toBe(PRODUCTION_TARGET_RE.source);
    expect(re(undefined).source).toBe(PRODUCTION_TARGET_RE.source);
  });
  it('zenithjoy：hk-vps / 100.86.118.99 / :5200 算生产，localhost:5221 也算；MMV 公网 IP、本机其他端口不算', () => {
    const z = re(zj);
    for (const c of ['curl http://100.86.118.99:5200/x', 'ssh hk-vps uptime', 'curl http://localhost:5200/api', 'curl localhost:5221/api/brain/tasks']) {
      expect(z.test(c), c).toBe(true);
    }
    for (const c of ['curl http://38.23.47.81:5305/api/x', 'node scripts/x.mjs --port 5302', 'curl http://127.0.0.1:5302/api']) {
      expect(z.test(c), c).toBe(false);
    }
  });
});

describe('repo-rules 提示词', () => {
  it('每个仓库登记了已知的预检清单与存在的规矩文件', () => {
    for (const r of REPOS) {
      expect(PRECHECK_SETS, r.key).toContain(r.prechecks);
      expect(fs.existsSync(path.join(WORKFLOW, r.rules_prompt)), r.rules_prompt).toBe(true);
    }
  });

  it('cecelia 规矩保留原有 CI 口径（Brain 源码配测试、feat 带 smoke、迁移编号顺延、cw-*-qa-smoke.sh 勿手改、QA 场景不写 localhost:5221）', () => {
    const t = repoRules(cecelia);
    for (const s of ['packages/brain/src', 'packages/brain/scripts/smoke', 'smoke-allowlist.txt', 'packages/brain/migrations', 'cw-*-qa-smoke.sh', 'localhost:5221', '<预览环境>']) {
      expect(t, s).toContain(s);
    }
    expect(repoRules(undefined)).toBe(t);
  });

  it('zenithjoy 规矩：test-registry.yaml 登记、无 changes/ 碎片、生产 hk-vps、local QA 只放行非 UI 非真机，UI/真机 spec 阶段写 QA_UNSUPPORTED 上交', () => {
    const t = repoRules(zj);
    for (const s of ['test-registry.yaml', '.test.mjs', 'changes/', 'hk-vps', 'QA_UNSUPPORTED:', '真机', 'UI', 'smoke-baseline.txt']) {
      expect(t, s).toContain(s);
    }
    expect(t).not.toContain('packages/brain/src');
  });

  it('带 {{REPO_RULES}} 的提示词全部渲染干净（不留占位符），且 cecelia 专属路径只出现在 cecelia 规矩里', () => {
    const prompts = ['build', 'ci-fix', 'ci-precheck-fix', 'conflict-fix', 'qa-fix', 'commander', 'spec'];
    for (const name of prompts) {
      const raw = fs.readFileSync(path.join(WORKFLOW, 'prompts', `${name}.md`), 'utf8');
      expect(raw, name).toContain('{{REPO_RULES}}');
      expect(raw, name).not.toContain('packages/brain/scripts/smoke/cw-');
      expect(raw, name).not.toContain('packages/brain/migrations');
      const out = loadPrompt(name, { REPO_RULES: repoRules(zj) });
      expect(out, name).not.toContain('{{REPO_RULES}}');
      expect(out, name).toContain('test-registry.yaml');
    }
  });

  it('evaluate-local 提示词：PR worktree 内黑盒、禁单元测试当证据、禁碰生产（列出本仓生产口径）、没有预览环境', () => {
    const p = fs.readFileSync(path.join(WORKFLOW, 'prompts/evaluate-local.md'), 'utf8');
    for (const s of ['WORKTREE: {{WORKTREE}}', 'PRODUCTION: {{PRODUCTION}}', '黑盒', '单元测试', '### T-n', '### X-n', 'CANNOT_VERIFY', '真机']) {
      expect(p, s).toContain(s);
    }
    expect(p).not.toContain('PREVIEW_URL');
  });
});
