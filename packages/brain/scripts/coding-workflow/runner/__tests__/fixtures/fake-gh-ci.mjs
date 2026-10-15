#!/usr/bin/env node
// 假 gh（CI 修复用）：argv 追加到 FAKE_GH_LOG；按 FAKE_GH_CI 指向的 JSON 回放：
// { prs: [...], required: { <pr>: [{name,bucket}] }, checks: { <pr>: [{name,bucket,link}] }, logs: { <jobId>: "..." },
//   prStates: { <pr_url 或 PR 号>: "MERGED"|"OPEN"|"CLOSED" }, prStateSeq: { <PR 号>: ["OPEN","CLOSED",...] }（逐次消费，用完停在最后一个）,
//   mergedPrs: [...], closedPrs: [...]（`pr list --state closed` 回放，外部关闭未合并）, events: { <PR 号>: [{event, actor:{login}}] },
//   byRepo: { <owner/repo>: { ...同上字段 } }（按 GH_REPO 环境变量覆盖顶层，多仓库门禁用） }
// FAKE_GH_REPO_LOG 指向文件时另记一行 { repo: GH_REPO, argv }（FAKE_GH_LOG 的格式不变）。
// `pr checks --required` 有 pending 时退出 8、有 fail 时退出 1（同真 gh），JSON 照常输出。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 供沙箱真实消费的CLI路径；import不触发回放或进程退出。
export const FAKE_GH_CI = fs.realpathSync(fileURLToPath(import.meta.url));

function main() {
  const argv = process.argv.slice(2);
  if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(argv)}\n`);
  if (process.env.FAKE_GH_REPO_LOG) fs.appendFileSync(process.env.FAKE_GH_REPO_LOG, `${JSON.stringify({ repo: process.env.GH_REPO ?? null, argv })}\n`);
  const base = process.env.FAKE_GH_CI ? JSON.parse(fs.readFileSync(process.env.FAKE_GH_CI, 'utf8')) : {};
  const state = base.byRepo?.[process.env.GH_REPO] ? { ...base, ...base.byRepo[process.env.GH_REPO] } : base;
  const out = (value, code = 0) => {
    process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
    process.exit(code);
  };

  if (argv[0] === 'pr' && argv[1] === 'list') {
    if (argv.includes('merged')) out(state.mergedPrs ?? []);
    if (argv.includes('closed')) out(state.closedPrs ?? []);
    out(state.prs ?? []);
  }
  // issues/<n>/events：PR 时间线（取关闭人）
  const events = argv[0] === 'api' ? /\/issues\/(\d+)\/events/.exec(argv[1] ?? '') : null;
  if (events) out(state.events?.[events[1]] ?? []);
  // pr view <url> --json state：按 prStates[url] 回放，未登记的 PR 报错退出 1
  // pr view <n> --json mergeable,mergeStateStatus：合并门判冲突/落后
  if (argv[0] === 'pr' && argv[1] === 'view' && argv.join(' ').includes('mergeable')) {
    out({ mergeable: state.mergeable ?? 'MERGEABLE', mergeStateStatus: state.mergeStateStatus ?? 'CLEAN' });
  }
  // pr merge：state.mergeExit 非 0 时模拟合并失败
  if (argv[0] === 'pr' && argv[1] === 'merge' && state.mergeExit) {
    process.stderr.write('merge failed\n');
    process.exit(state.mergeExit);
  }
  // pr merge 成功 + --delete-branch：同真 gh 删掉远端分支（cwd 是 runner 的仓库克隆）
  if (argv[0] === 'pr' && argv[1] === 'merge' && argv.includes('--delete-branch')) {
    const branch = (state.prs ?? []).find((p) => String(p.number) === argv[2])?.headRefName;
    if (branch) execFileSync('git', ['push', '-q', 'origin', '--delete', branch], { stdio: 'ignore' });
    // 故障注入：仅杀沙箱 run-once 子进程，模拟 GitHub 已成功、runner 尚未写本地标记。
    if (state.crashAfterMerge) process.kill(process.ppid, 'SIGKILL');
  }
  // pr view <n> --json state：prStateSeq 逐次消费 > prStates > 在 prs（open 列表）里即 OPEN
  if (argv[0] === 'pr' && argv[1] === 'view') {
    if (argv.at(-1).includes('headRefName')) {
      const pr = state.prDetails?.[argv[2]] ?? [...(state.prs ?? []), ...(state.closedPrs ?? []), ...(state.mergedPrs ?? [])].find((p) => String(p.number) === argv[2]);
      if (!pr) process.exit(1);
      out({ ...pr, state: pr.state ?? 'OPEN' });
    }
    const seq = state.prStateSeq?.[argv[2]];
    if (Array.isArray(seq) && seq.length > 0 && process.env.FAKE_GH_CI) {
      const counter = `${process.env.FAKE_GH_CI}.seq-${argv[2]}`;
      const i = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
      fs.writeFileSync(counter, String(i + 1));
      out({ state: seq[Math.min(i, seq.length - 1)] });
    }
    const s = state.prStates?.[argv[2]] ?? ((state.prs ?? []).some((p) => String(p.number) === argv[2]) ? 'OPEN' : null);
    if (!s) process.exit(1);
    out({ state: s });
  }
  if (argv[0] === 'pr' && argv[1] === 'checks') {
    const pr = argv[2];
    if (argv.includes('--required')) {
      const rows = state.required?.[pr];
      if (!rows) {
        process.stderr.write("no required checks reported on the branch\n");
        process.exit(1);
      }
      const code = rows.some((r) => r.bucket === 'pending') ? 8 : rows.some((r) => r.bucket === 'fail') ? 1 : 0;
      out(rows, code);
    }
    out(state.checks?.[pr] ?? []);
  }
  // 仓库规定的必需检查（分支保护 + 规则集，runner 用 --jq 取成名字数组）：requiredContexts 默认 ['ci-passed']，
  // rulesetContexts 默认 []；requiredContextsFail=true 时分支保护查询失败退出 1
  if (argv[0] === 'api' && /\/protection\/required_status_checks$/.test(argv[1] ?? '')) {
    if (state.requiredContextsFail) process.exit(1);
    out(state.requiredContexts ?? ['ci-passed']);
  }
  if (argv[0] === 'api' && /\/rules\/branches\//.test(argv[1] ?? '')) out(state.rulesetContexts ?? []);
  const job = argv[0] === 'api' ? /\/actions\/jobs\/(\d+)\/logs$/.exec(argv[1] ?? '') : null;
  if (job) out(state.logs?.[job[1]] ?? '');
  process.exit(Number(process.env.FAKE_GH_EXIT || 0));
}

// 兼容相对路径及可执行软链；只有当前入口真实指向本文件才运行。
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === FAKE_GH_CI) main();
