/**
 * registry-vs-base.audit.test.js（终审 I4）
 *
 * `scripts/audit/registry-vs-base.mjs`（Task 6 补充六）是"注册表 vs 基线源码"机械
 * 审计——PR1 结束时本该逐条核实过一次（task-6-report.md 记录 66 sites PASS64/
 * SKIP2/FAIL0），但审计脚本本身从未接进 CI/单测棘轮：它只是仓库里的一个可手动跑
 * 的 .mjs 文件，没有任何测试断言"这个脚本必须 exit 0"。这意味着后续任何一次改动
 * 让某个站点与基线走样（比如误改了某个 site() 的 extract 锚点、或注册表派生值被
 * 悄悄改动），脚本会本地报错，但 CI 全绿，没人会发现——"审计存在"不等于"审计生效"。
 *
 * 本测试把它接成棘轮：spawn `node scripts/audit/registry-vs-base.mjs`，断言
 * exit 0 且输出含 `FAIL/ERROR 0`（脚本真实汇总行格式，见该文件 :324
 * `合计：N 站点，PASS x，SKIP y，FAIL/ERROR z`）。
 *
 * 脚本依赖 `git show <base_sha>:...` 读基线源码（不落盘、不需要网络），CI 的
 * checkout 天然带完整 git 历史，能跑；但不排除某些沙箱/裸目录环境没有 git 命令或
 * 不是 git 仓库——这种环境下本测试不该假红，用 `it.skipIf` 跳过并打印原因。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CODING_MUTATION_TASK_TYPES } from '../lib/task-type-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = join(HERE, '..', '..'); // packages/brain
const SCRIPT = join(BRAIN_DIR, 'scripts', 'audit', 'registry-vs-base.mjs');

function detectSkipReason() {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
  } catch {
    return 'git 命令不可用（脚本靠 git show 读基线源码，没有 git 无法验证）';
  }
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: BRAIN_DIR, stdio: 'pipe' });
  } catch {
    return `${BRAIN_DIR} 不在 git 工作树内（脚本靠 git rev-parse --show-toplevel 定位仓库根）`;
  }
  return null;
}

const skipReason = detectSkipReason();
if (skipReason) {
  // eslint-disable-next-line no-console
  console.warn(`[SKIP] registry-vs-base.audit.test.js: ${skipReason}`);
}

describe('registry-vs-base 审计脚本是 CI 棘轮（终审 I4）', () => {
  it('#6371 coding_workflow 必须保留编码变更语义，不能被历史基线豁免掩盖删除', () => {
    expect(CODING_MUTATION_TASK_TYPES).toContain('coding_workflow');
  });

  it.skipIf(Boolean(skipReason))('node scripts/audit/registry-vs-base.mjs 必须 exit 0 且 FAIL/ERROR 0', () => {
    expect(existsSync(SCRIPT), `审计脚本不存在：${SCRIPT}`).toBe(true);

    let stdout = '';
    let exitCode = 0;
    try {
      stdout = execFileSync('node', [SCRIPT], { cwd: BRAIN_DIR, encoding: 'utf8' });
    } catch (err) {
      // execFileSync 在子进程非 0 退出时抛错；err.status 是真实退出码，
      // err.stdout/err.stderr 携带子进程的输出（脚本 process.exit(1) 前已 console.log 完对照表）。
      exitCode = err.status ?? 1;
      stdout = `${err.stdout || ''}${err.stderr || ''}`;
    }

    expect(exitCode, `审计脚本非 0 退出，完整输出：\n${stdout}`).toBe(0);
    expect(
      stdout,
      `审计输出里没找到 "FAIL/ERROR 0" 汇总行，说明有站点与基线不等或提取失败，完整输出：\n${stdout}`,
    ).toMatch(/FAIL\/ERROR 0\b/);
  });
});

// 用真实本地Git历史复现actions/checkout的depth语义，不替代上方正式基线审计。
it('DoD动态命令的checkout必须能读取固定历史基线',()=>{
 const workflow=yaml.load(readFileSync(join(BRAIN_DIR,'../../.github/workflows/ci.yml'),'utf8'));
 const checkout=workflow.jobs['dod-behavior-dynamic'].steps.find(s=>s.uses?.startsWith('actions/checkout@'));
 const depth=checkout.with?.['fetch-depth']??1;
 const root=mkdtempSync(join(tmpdir(),'dod-baseline-')),origin=join(root,'origin'),clone=join(root,'checkout');
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git(root,'init','-q',origin);git(origin,'config','user.name','fixture');git(origin,'config','user.email','fixture@example.invalid');
  writeFileSync(join(origin,'baseline.txt'),'fixed baseline');git(origin,'add','.');git(origin,'commit','-qm','baseline');const base=git(origin,'rev-parse','HEAD');
  writeFileSync(join(origin,'baseline.txt'),'current bytes');git(origin,'commit','-qam','head');
  git(root,'clone','-q',...(Number(depth)===0?[]:['--depth',String(depth)]),`file://${origin}`,clone);
  let baseline;try{baseline=git(clone,'show',`${base}:baseline.txt`);}catch{baseline='BASELINE_OBJECT_MISSING';}
  expect(baseline).toBe('fixed baseline');
 }finally{rmSync(root,{recursive:true,force:true});}
});
