# Learning — fix(brain): buildGeneratorPrompt inline SKILL pattern (Bug 7)

**日期**: 2026-05-11
**分支**: cp-0511125107-brain-generator-inline-skill
**类型**: fix（PR D 漏改的 generator builder）

## 背景

W24 用 PR A+B+C+D 跑通 — proposer 写 34 [BEHAVIOR]，reviewer 7 维 rubric，evaluator 真跑全部。但 generator 仍漂字段名 `{factorial}` 不用 `{result, operation}`。

cecelia-harness-debug Layer 2 SKILL Discovery 排查 5 min 锁定 root：buildGeneratorPrompt 仍 slash command pattern。

### 根本原因

PR D 修了 `harness-gan.graph.js` 里的 buildReviewerPrompt + buildProposerPrompt 用 inline pattern。但 generator builder 在 **不同文件** `harness-utils.js:147`，PR D 没扫到 → 漏修。

5 个 agent prompt builder 现状：

| Agent | Builder 位置 | 模式 |
|---|---|---|
| planner | harness-initiative.graph.js:84 | inline ✓ |
| proposer | harness-gan.graph.js:191 | inline ✓ (PR D) |
| reviewer | harness-gan.graph.js:221 | inline ✓ (PR D) |
| evaluator | harness-initiative.graph.js:1175 | inline ✓ (一直) |
| **generator** | **harness-utils.js:147** | **slash command ✗** (PR D 漏) |

### 下次预防

- [x] 改一类 builder 时**必须 grep 全代码库**找同类 pattern：`grep -rn "'/harness-" packages/brain/src/`
- [x] PR D 应该一次性修 5 个 builder（看 ALL `loadSkillContent` 使用 + ALL `'/harness-*'` slash command）
- [x] PR F（接续）抽 buildAgentPrompt(agentName) 通用 helper，5 个 builder 全用它，强制架构一致
- [x] 任何"agent 行为不符预期"先用 cecelia-harness-debug Layer 2 验 prompt 实际内容

## 修复

import loadSkillContent + 改 buildGeneratorPrompt 用 inline pattern（学 PR D 模式）：

```js
import { loadSkillContent } from './harness-shared.js';

export function buildGeneratorPrompt(task, { fixMode = false } = {}) {
  const skillContent = loadSkillContent('harness-generator');
  return [
    '你是 harness-generator agent。按下面 SKILL 指令工作。',
    '',
    skillContent,
    '',
    '---',
    '',
    fixMode ? '**FIX mode**...' : '',
    `task_id: ${task.id}`,
    ...
  ].join('\n');
}
```

## 验收锚点

PR 合并后派 W25：
- 期望 1：generator prompt > 14KB（inline SKILL 后）
- 期望 2：prompt 含 "Contract Self-Verification" 关键词
- 期望 3：generator 真跑 Step 6.5 自验 → 抓字段漂移 → 自修
- 期望 4：task=completed 或至少 generator code 严守 schema

## 跟 PR F 关系

PR E 修单 builder。PR F 抽通用 helper，根本治理 — "未来不会再漏"。两个 PR 互补。
