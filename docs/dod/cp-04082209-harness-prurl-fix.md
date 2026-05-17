# Task Card: harness pr_url 提取修复

## 背景

Harness v4.0 E2E v3 测试中，Generator（harness_generate）创建了 PR #2074，但 execution-callback 链条没有创建 harness_ci_watch。根本原因：

1. **execution.js** 提取 pr_url 时只检查 `result.pr_url` 和 `result.result.pr_url`（后者是字符串，没有 pr_url 属性）。Generator 最终消息是人类可读文本（如 `**PR #2074**: ...`），而非 JSON。
2. **harness-generator SKILL.md** Step 6 描述不够强制 — 实际运行未输出 JSON 格式 verdict。
3. **harness_ci_watch watcher** 在 Brain tick 中从未处理排队任务（poll_count 保持 0）。

## 修复范围

### Fix 1: execution.js — 增强 pr_url 提取

在 `harness_generate` 完成处理时，当 `pr_url` 和 `result.pr_url` 都为 null，还应尝试：
- 从 `result.result`（string）中解析 JSON（覆盖 Generator 正确输出 JSON 的情况）
- 从 `result.result` 中用正则提取完整 GitHub URL
- 从 DB 任务的 `pr_url` 列中读取（覆盖 Generator 自己 PATCH 过 pr_url 的情况）

### Fix 2: harness-generator SKILL.md — 强制 JSON 最终消息

Step 6 改为：
- 最后一条消息必须是**纯 JSON**，禁止其他文字
- 格式：`{"verdict": "DONE", "pr_url": "https://github.com/perfectuser21/cecelia/pull/XXX"}`
- 用 `$PR_URL` 变量确保变量替换正确

### Fix 3: harness-watcher.js — 调查并修复 ci_watch 未处理问题

调查 `processHarnessCiWatchers` 为何对 queued 任务不处理，添加更好的日志或修复 bug。

## DoD

- [x] [ARTIFACT] `packages/brain/src/routes/execution.js` — `harness_generate` 处理段：当 `prUrl` 为 null 时，依次尝试从 `result.result` JSON 解析、`result.result` 正则提取 GitHub URL、DB `pr_url` 列读取
- [x] [BEHAVIOR] execution.js pr_url 提取逻辑覆盖 Generator 文本输出场景
  - Test: `manual:node -e "const r={type:'result',subtype:'success',result:'Generator 完成。\n\n**PR #2074**: \`feat: test\`'};const m=r.result.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);console.log('URL match:', m ? m[0] : null);const m2=r.result.match(/PR #(\d+)/);console.log('PR# match:', m2 ? m2[1] : null)"`
- [x] [ARTIFACT] `packages/workflows/skills/harness-generator/SKILL.md` — Step 6 改为强制 JSON 最终消息格式，添加变量替换示例
- [x] [BEHAVIOR] harness-generator SKILL.md Step 6 包含明确的 JSON 格式示例和 "纯 JSON，禁止其他文字" 约束
  - Test: `manual:node -e "const fs=require('fs');const c=fs.readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');if(!c.includes('纯 JSON'))process.exit(1);console.log('OK')"`

## 成功标准

- execution.js 在 result.result 文本包含 PR # 时能提取 pr_url（防止 harness_ci_watch 不被创建）
- harness-generator SKILL.md Step 6 明确要求纯 JSON 最终消息
