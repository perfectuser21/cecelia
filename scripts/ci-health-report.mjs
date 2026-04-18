#!/usr/bin/env node
/**
 * ci-health-report.mjs — CI 稳定性看板
 *
 * 通过 `gh` CLI 拉取最近 N 次 workflow 运行，计算：
 *   - 总体绿灯率
 *   - 每个 job 的成功/失败/跳过次数
 *   - flaky job 识别（同一 commit 多次 attempt 结果不同 或 短时间同 job 结果反复）
 *   - 最近 20 次失败原因摘要（job 名 + 运行 URL）
 *
 * 用法：
 *   node scripts/ci-health-report.mjs [--workflow ci.yml] [--limit 100] [--format md|json]
 *   node scripts/ci-health-report.mjs --limit 50 > reports/ci-health.md
 *
 * 退出码：
 *   0 = 正常生成
 *   1 = gh 调用失败或数据异常
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const WORKFLOW = getArg('workflow', 'ci.yml');
const LIMIT = Number(getArg('limit', '100'));
const FORMAT = getArg('format', 'md');
const OUT = getArg('out', null);

function gh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function fetchRuns() {
  const raw = gh(
    `gh run list --workflow=${WORKFLOW} --limit ${LIMIT} ` +
      `--json databaseId,conclusion,status,displayTitle,createdAt,event,headSha,headBranch`
  );
  return JSON.parse(raw);
}

function fetchJobs(runId) {
  try {
    const raw = gh(`gh run view ${runId} --json jobs`);
    return JSON.parse(raw).jobs || [];
  } catch {
    return [];
  }
}

function summarize(runs) {
  const byConclusion = {};
  for (const r of runs) {
    const k = r.conclusion || 'in_progress';
    byConclusion[k] = (byConclusion[k] || 0) + 1;
  }
  const total = runs.length;
  const success = byConclusion.success || 0;
  const failure = byConclusion.failure || 0;
  const cancelled = byConclusion.cancelled || 0;
  const successRate = total > 0 ? ((success * 100) / total).toFixed(1) : '0.0';
  return { total, success, failure, cancelled, successRate, byConclusion };
}

function analyzeFailedJobs(runs, sampleSize = 30) {
  // 只抽取最近 sampleSize 次失败 run 的 jobs，避免打爆 API。
  const failed = runs.filter((r) => r.conclusion === 'failure').slice(0, sampleSize);
  const jobFailureCount = {};
  const failuresDetail = [];
  for (const r of failed) {
    const jobs = fetchJobs(r.databaseId);
    const failedJobs = jobs
      .filter((j) => j.conclusion === 'failure')
      .map((j) => j.name);
    for (const name of failedJobs) {
      // matrix 变体合并：brain-unit (3) → brain-unit
      const norm = name.replace(/\s*\([^)]*\)\s*$/, '');
      jobFailureCount[norm] = (jobFailureCount[norm] || 0) + 1;
    }
    failuresDetail.push({
      runId: r.databaseId,
      createdAt: r.createdAt,
      title: r.displayTitle,
      jobs: failedJobs,
    });
  }
  const ranked = Object.entries(jobFailureCount)
    .sort((a, b) => b[1] - a[1])
    .map(([job, count]) => ({ job, count }));
  return { ranked, failuresDetail, sampleSize: failed.length };
}

function detectFlakes(runs) {
  // flake 启发式：同一 branch 在 10 分钟内先 fail 后 success 的连续 run
  const byBranch = {};
  for (const r of runs) {
    if (!r.headBranch) continue;
    (byBranch[r.headBranch] ||= []).push(r);
  }
  const flakes = [];
  for (const [branch, rs] of Object.entries(byBranch)) {
    const sorted = [...rs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.conclusion === 'failure' && curr.conclusion === 'success') {
        const gap = (new Date(curr.createdAt) - new Date(prev.createdAt)) / 60000;
        if (gap < 30) {
          flakes.push({
            branch,
            failRunId: prev.databaseId,
            passRunId: curr.databaseId,
            gapMinutes: gap.toFixed(1),
            title: prev.displayTitle,
          });
        }
      }
    }
  }
  return flakes;
}

function renderMarkdown(s, runs, jobAnalysis, flakes) {
  const lines = [];
  lines.push('# CI 稳定性看板');
  lines.push('');
  lines.push(`> 生成时间：${new Date().toISOString()}`);
  lines.push(`> Workflow：\`${WORKFLOW}\`  样本：最近 ${s.total} 次运行`);
  lines.push('');
  lines.push('## 总体指标');
  lines.push('');
  lines.push(`| 指标 | 数值 |`);
  lines.push(`| --- | --- |`);
  lines.push(`| 总运行数 | ${s.total} |`);
  lines.push(`| ✅ 成功 | ${s.success} |`);
  lines.push(`| ❌ 失败 | ${s.failure} |`);
  lines.push(`| ⏹ 取消 | ${s.cancelled} |`);
  lines.push(`| **绿灯率** | **${s.successRate}%** |`);
  lines.push('');
  lines.push('## Top 失败 Job（按频率降序）');
  lines.push('');
  if (jobAnalysis.ranked.length === 0) {
    lines.push('_样本内无失败 job_');
  } else {
    lines.push('| Job | 失败次数 |');
    lines.push('| --- | --- |');
    for (const { job, count } of jobAnalysis.ranked.slice(0, 10)) {
      lines.push(`| \`${job}\` | ${count} |`);
    }
    lines.push('');
    lines.push(`_基于最近 ${jobAnalysis.sampleSize} 次失败运行的 job 分布_`);
  }
  lines.push('');
  lines.push('## Flaky 识别（同 branch 先 fail 后 pass，间隔 < 30 分钟）');
  lines.push('');
  if (flakes.length === 0) {
    lines.push('_样本内未检测到明显 flake_');
  } else {
    lines.push('| Branch | Fail → Pass (分钟) | Title |');
    lines.push('| --- | --- | --- |');
    for (const f of flakes.slice(0, 15)) {
      const title = (f.title || '').slice(0, 60).replace(/\|/g, '\\|');
      lines.push(`| \`${f.branch}\` | ${f.gapMinutes} | ${title} |`);
    }
  }
  lines.push('');
  lines.push('## 最近失败（最多 10 条）');
  lines.push('');
  const recentFailures = runs.filter((r) => r.conclusion === 'failure').slice(0, 10);
  if (recentFailures.length === 0) {
    lines.push('_无_');
  } else {
    for (const r of recentFailures) {
      const title = (r.displayTitle || '').slice(0, 80);
      lines.push(`- ${r.createdAt.slice(0, 16)} [\`#${r.databaseId}\`] ${title}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const runs = fetchRuns();
  if (!Array.isArray(runs) || runs.length === 0) {
    console.error('[ci-health-report] 未获取到 runs，检查 gh 凭据与 workflow 名');
    process.exit(1);
  }
  const summary = summarize(runs);
  const jobAnalysis = analyzeFailedJobs(runs);
  const flakes = detectFlakes(runs);

  if (FORMAT === 'json') {
    const output = JSON.stringify({ summary, jobAnalysis, flakes, runs }, null, 2);
    if (OUT) {
      writeFileSync(OUT, output);
      console.error(`[ci-health-report] JSON written to ${OUT}`);
    } else {
      console.log(output);
    }
  } else {
    const md = renderMarkdown(summary, runs, jobAnalysis, flakes);
    if (OUT) {
      writeFileSync(OUT, md);
      console.error(`[ci-health-report] Markdown written to ${OUT}`);
    } else {
      console.log(md);
    }
  }
}

main();
