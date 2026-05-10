contract_branch: cp-harness-propose-r2-fe91ce26
workstream_index: 1
sprint_dir: sprints

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: harness happy path marker module

**范围**：新增最小可观测目标模块（常量 + 函数）+ BEHAVIOR 测试。Generator 在 commit 1 落测试（Red），commit 2 落实现（Green）。
**大小**：S（实现 + 测试合计 < 30 行）
**依赖**：无

## ARTIFACT 条目

- [ ] [ARTIFACT] BEHAVIOR 测试文件存在于 `packages/brain/tests/ws1/harness-happy-path-marker.test.js`，内容含 `from 'vitest'` import 与至少 2 个 `it(` block，且引用 `HARNESS_HAPPY_PATH_MARKER` 标识符
  Test: node -e "const fs=require('fs');const p='packages/brain/tests/ws1/harness-happy-path-marker.test.js';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');const head=c.split('\n').slice(0,60).join('\n');if(!/from ['\"]vitest['\"]/.test(head))process.exit(1);const itCount=(c.match(/\bit\s*\(/g)||[]).length;if(itCount<2)process.exit(1);if(!c.includes('HARNESS_HAPPY_PATH_MARKER'))process.exit(1)"

- [ ] [ARTIFACT] 实现文件存在于 `packages/brain/src/harness-happy-path-marker.js`
  Test: node -e "const fs=require('fs');if(!fs.existsSync('packages/brain/src/harness-happy-path-marker.js'))process.exit(1)"

- [ ] [ARTIFACT] 实现文件源码含 `export const HARNESS_HAPPY_PATH_MARKER` 声明
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-happy-path-marker.js','utf8');if(!/export\s+const\s+HARNESS_HAPPY_PATH_MARKER\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 实现文件源码含 `export function verifyHarnessHappyPath` 声明
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-happy-path-marker.js','utf8');if(!/export\s+function\s+verifyHarnessHappyPath\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 实现文件源码字面量含 `fe91ce26-5nodes-verified`（child task signature 防跨 PR 复用）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-happy-path-marker.js','utf8');if(!c.includes('fe91ce26-5nodes-verified'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 packages/brain/tests/ws1/）

见 `packages/brain/tests/ws1/harness-happy-path-marker.test.js`，覆盖：
- `HARNESS_HAPPY_PATH_MARKER` 严格等于 `'fe91ce26-5nodes-verified'`
- `verifyHarnessHappyPath()` 返回相同字符串

测试由 Generator 从 `sprints/tests/ws1/harness-happy-path-marker.test.js` **原样复制**，commit 1 落地后 CI 强校验不可修改。
