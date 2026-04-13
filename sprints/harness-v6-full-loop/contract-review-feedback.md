# Contract Review Feedback (Round 2)

## 必须修改项

### 1. [假阴性] Feature 1 C1 — regex 窗口 {0,500} 太小，正确实现永远 FAIL

**原始命令**:
```bash
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  if (!code.match(/ciStatus\s*===?\s*['\"]ci_passed['\"][\s\S]{0,500}executeMerge/)) {
    throw new Error('FAIL: executeMerge 未在 ci_passed 条件下调用');
  }
  ...
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 不需要假实现——当前 harness-watcher.js 中的正确实现本身就 FAIL：
// ciStatus === 'ci_passed' (char 3708) → executeMerge (char 4243) = 535 chars > 500 limit
// 实测：
const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
console.log(code.match(/ciStatus\s*===?\s*['"]ci_passed['"][\s\S]{0,500}executeMerge/));
// → null（即使实现完全正确）
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 窗口从 {0,500} 扩大到 {0,800}，当前实际距离 535 chars，留出余量
  if (!code.match(/ciStatus\s*===?\s*['\"]ci_passed['\"][\s\S]{0,800}executeMerge/)) {
    throw new Error('FAIL: executeMerge 未在 ci_passed 条件下调用');
  }
  // ci_failed 分支窗口已足够（{0,800}），保持不变
  if (!code.match(/ciStatus\s*===?\s*['\"]ci_failed['\"][\s\S]{0,800}harness_fix/)) {
    throw new Error('FAIL: ci_failed 分支未创建 harness_fix 任务');
  }
  console.log('PASS: Auto-Merge 条件逻辑完整（ci_passed→merge, ci_failed→fix）');
"
```

### 2. [命令太弱] Feature 3 C7 — CRASH 检测 regex 可被注释蒙混

**原始命令**:
```bash
node -e "
  ...
  if (!code.match(/CRASH|crash.*verdict|verdict.*crash|fallback.*verdict/i)) {
    throw new Error('FAIL: 缺少 CRASH 兜底');
  }
  ...
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：一行注释即可通过全部四个 OR 分支
// file: packages/brain/src/routes/execution.js
// 在任意位置添加：
// TODO: handle CRASH verdict fallback when agent crashes
// → /CRASH/i 匹配 ✓, /crash.*verdict/i 匹配 ✓, /verdict.*crash/i 匹配 ✓, /fallback.*verdict/i 匹配 ✓
// 但没有任何实际逻辑
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 要求：1) verdict 赋值语句中含 CRASH  2) 与条件判断相关联（非纯注释）
  // 检测 verdict 被赋值为 CRASH（字符串赋值，不是注释）
  if (!code.match(/verdict\s*[=:]\s*['\"]CRASH['\"]/)) {
    throw new Error('FAIL: 缺少 verdict = CRASH 赋值语句（仅注释不算）');
  }
  // 检测与 agent 失败/无 verdict 条件关联
  if (!code.match(/(no.*verdict|!.*verdict|missing.*verdict|agent.*(fail|crash|exit))[\s\S]{0,300}CRASH/i)) {
    throw new Error('FAIL: CRASH 赋值未与 agent 失败条件关联');
  }
  console.log('PASS: CRASH 兜底逻辑存在（条件判断 + verdict 赋值）');
"
```

## 可选改进

1. **C16 当前已 PASS**：StageTimeline 组件、stages prop、DetailStage 类型（含 task_type/status）均已存在。建议加一个测试验证 stages 被实际渲染（如检查 `.map` 遍历），而非仅检查组件声明。

2. **C3/C5/C9 均为回归守护**：当前代码已通过，不测新行为。可接受（防止 Generator 意外破坏已有功能），但 Proposer 应意识到这些命令不驱动新实现。

3. **PRD 边界 "Dashboard build 失败不阻塞 Evaluator"** 和 **"并发 pipeline 排队"** 无对应验证命令——建议在 WS2 或 WS3 补充（优先级低于上述两个必修项）。
