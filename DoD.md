# DoD：harness_initiative 全局 fresh-start 上限

Brain task: 65b4e93a-731a-4a45-a595-42761a893757
分支: cp-06030939-max-fresh-starts

## 背景

`runHarnessInitiativeRouter` 遇坏 checkpoint（`channel_values.error` 有值）时升 `attemptN` 做
fresh-start 从头重跑 planner。`execution_attempts` 一直涨却**从无上限判定** → 本机 Docker 抽风时
无限重跑、20+ planner 容器、永不收敛。本 PR 加全局上限，把"无限 fresh-start"变成"有界 → terminal failed"。

## 改动

- [x] [ARTIFACT] 导出命名常量 `MAX_INITIATIVE_FRESH_STARTS`（默认 3），便于测试引用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!/export const MAX_INITIATIVE_FRESH_STARTS = 3/.test(c))process.exit(1)"

- [x] [BEHAVIOR] `execution_attempts >= MAX_INITIATIVE_FRESH_STARTS` → 不 invoke graph，标 status='failed' + failure_class='max_fresh_starts_exceeded'，返回 `terminal:true`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!/\(task\.execution_attempts \|\| 0\) >= MAX_INITIATIVE_FRESH_STARTS/.test(c))process.exit(1);if(!/max_fresh_starts_exceeded[\s\S]{0,200}terminal: true/.test(c))process.exit(1);if(!/status='failed'/.test(c))process.exit(1)"

- [x] [BEHAVIOR] resume 分支：`existing.channel_values?.error?.terminal === true` → 同样视为 terminal（Wave 2b 钩子，不 fresh-start）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!/error\?\.terminal === true/.test(c))process.exit(1);if(!/checkpoint_terminal/.test(c))process.exit(1)"

## 验收

- [x] failing test 先写（4 用例 RED），实现后全绿（GREEN）
- [x] regression test 永久留 CI：`packages/brain/src/__tests__/harness-max-fresh-starts.test.js`
- [x] 既有 `harness-resume-checkpoint-error-state.test.js` 6/6 仍绿（无回归，execution_attempts<上限不受影响）
- [x] 未碰节点 catch→error→END 逻辑 / GAN / interrupt()（Wave 2b 范畴）
- [x] Brain 版本四处同步 bump（1.230.16 → 1.230.17）
- [x] DevGate 通过（facts-check / version-sync）
