# Learning - propose_branch fallback (cp-0426100009)

Brain task: 582a24f2-5ba0-4753-89bc-1657deda54d3
PR 类型: feat (1 行核心修复 + 测试)

## 现象

Initiative pipeline 卡死在最后一跳：sub-task `payload.contract_branch=空` →
Generator 启动后立刻 ABORT，整条流水线无产物。

## 根本原因

`packages/brain/src/workflows/harness-gan.graph.js` 的 `extractProposeBranch(stdout)`
依赖 proposer SKILL 在 stdout 写出 `{"propose_branch": "cp-..."}` 字面量。
当 SKILL 实现漂移、prompt 改了输出格式、或被中间日志切断时，正则 `PROPOSE_BRANCH_RE`
抽不到，函数返回 `null`。

老代码：

```js
...(proposeBranch ? { proposeBranch } : {}),
```

null 不写入 state → finalState.proposeBranch === undefined →
`runGanContractGraph` 返回值 `propose_branch: finalState.proposeBranch || null` →
contract.branch=null → sub-task payload.contract_branch=空 → Generator ABORT。

唯一一条出路（SKILL 输出）有单点失败但没 fallback。

## 修复

1. 新增 `export function fallbackProposeBranch(taskId, now=new Date())`，
   生成 `cp-${MMDDHHmm}-${taskId.slice(0,8)}`（Asia/Shanghai 时区，与 worktree-manage.sh 创建分支风格一致）。
2. proposer 节点中改 1 行：

```js
const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId);
```

并将 `...(proposeBranch ? { proposeBranch } : {})` 改成无条件写入 `proposeBranch`。
fallback 后 contract.branch 永远非空，端到端能跑通。

## 下次预防

- [ ] 任何"依赖外部 agent stdout 抽字段"的代码必须有 fallback，禁止 null 透传到 sub-task payload。
- [ ] PRD/contract 关键字段（branch / sprint_dir / workstream_index）在 graph 节点出口处统一兜底，不在 caller 做 null 检查。
- [ ] 后续设计：考虑直接用 git 命令在 worktree 里 `rev-parse --abbrev-ref HEAD` 验证分支，比 stdout 抽 JSON 更可靠。
