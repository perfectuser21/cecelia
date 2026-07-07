// skill-contract-check.mjs
// 纯函数 skill 契约不变量检查器。每个 checkX(content) → { ok, missing }。
// missing 列出缺失/违规的不变量名（空数组 = 全部满足）。
// 设计意图：判定逻辑全落在可本地跑的纯函数里，供 vitest 守现网快照、供 CI 篡改反例验证。

// 去除 YAML frontmatter（开头第一对 '---' 之间的内容），只保留正文。
// 不变量只扫正文：changelog 里描述清理动作的 ws_id 不算残留。
function stripFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0] && lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        return lines.slice(i + 1).join('\n');
      }
    }
  }
  return content;
}

// 不变量 1+2：evaluator 正文含 env_missing / B-1.6 / B-1.8 段，且正文无 ws_id 残留。
// B-1.7 弱 oracle/作弊扫描已于 evaluator v1.16.0 拍板下沉 Contract Gate 代码层（#3348），
// 不再是 skill 正文契约——快照 1.20.0 起墓碑标题也已移除，断言同步删除。
export function checkEvaluator(content) {
  const body = stripFrontmatter(content);
  const missing = [];
  for (const tok of ['env_missing', 'B-1.6', 'B-1.8']) {
    if (!body.includes(tok)) missing.push(tok);
  }
  if (body.includes('ws_id')) missing.push('ws_id_residual');
  return { ok: missing.length === 0, missing };
}

// 不变量 3：reviewer 7 维名（须与 packages/brain/src/harness-shared.js 的
// ReviewerOutputSchema.rubric_scores keys 逐字一致 —— harness::rubric-dimensions 接口约定）。
export const REVIEWER_DIMENSIONS = [
  'dod_machineability',
  'scope_match_prd',
  'test_is_red',
  'internal_consistency',
  'risk_registered',
  'verification_oracle_completeness',
  'ci_workflow_alignment',
];

export function checkReviewer(content) {
  const missing = REVIEWER_DIMENSIONS.filter((d) => !content.includes(d));
  return { ok: missing.length === 0, missing };
}

// 不变量 4：generator 无「可执行」gh pr merge。
// bash/sh 代码栅栏内、以 gh pr merge 开头的命令行 = 违规；
// changelog / 红线 blockquote 里的 prose 提及（含反引号包裹）允许。
export function checkGenerator(content) {
  const missing = [];
  const fenceRe = /```(?:bash|sh|shell)?[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(content)) !== null) {
    const block = m[1];
    for (const raw of block.split('\n')) {
      if (/^\s*gh\s+pr\s+merge\b/.test(raw)) {
        missing.push('executable_gh_pr_merge');
        break;
      }
    }
    if (missing.length) break;
  }
  return { ok: missing.length === 0, missing };
}

// 不变量 5：proposer 正文含「领域验证规则」段。
export function checkProposer(content) {
  const body = stripFrontmatter(content);
  const missing = [];
  if (!body.includes('领域验证规则')) missing.push('领域验证规则');
  return { ok: missing.length === 0, missing };
}
