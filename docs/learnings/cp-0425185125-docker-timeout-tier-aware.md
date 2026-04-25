# Learning: Docker Timeout 默认值与代码实际值脱节 + 缺时间维度

## 现象

Generator 容器跑大改动（多文件 + GAN 多轮 + CI 等待）正常需 1-2 小时，第一次 Gen2 就被 SIGKILL。
原因是 `packages/brain/src/docker-executor.js:36` `DEFAULT_TIMEOUT_MS = 900000`（15min），
`.env.docker` 里改了 CECELIA_DOCKER_TIMEOUT_MS 但代码 default 一直没改，且不分 tier。

### 根本原因

- "硬编码 default + env override"模式让代码 default 长期被忽视，`.env.docker` 只是临时补丁，不持久（重建容器丢）
- RESOURCE_TIERS 只有 memoryMB / cpuCores 两维度，缺时间维度 → 无法表达"重任务跑久点"的合理诉求
- 一刀切 timeout 让 light 任务（30s 出结果的 planner）也得占容器槽 90min，浪费产能

### 下次预防

- [ ] env override 默认值变更时同步改代码 default（修改前 grep 一遍变量名）
- [ ] 资源 tier 概念扩展时把 memory/cpu/timeout 三件套放一起（避免下次新增第四个维度散落各处）
- [ ] mock runDocker 写 tier override 行为测试比"读源码 grep"更稳（行为测试 vs 文本测试）
- [ ] DEFAULT_X_MS 这种全局兜底值，PRD 时就标注"per-tier override 会覆盖此值"，避免未来误改 default 以为能影响所有 tier

## 修复

- `packages/brain/src/spawn/middleware/resource-tier.js` `RESOURCE_TIERS` 加 timeoutMs：
  - light: 30 min
  - normal: 90 min
  - heavy: 120 min
  - pipeline-heavy: 180 min
- `packages/brain/src/docker-executor.js`
  - DEFAULT_TIMEOUT_MS: 900000 → 5400000 (90 min)
  - executeInDocker 优先级：`opts.timeoutMs > tier.timeoutMs > DEFAULT_TIMEOUT_MS`
  - log 行加 timeout 字段（forensic）
- `packages/brain/src/__tests__/docker-executor-timeout.test.js`：mock runDocker，验证 4 个 tier 的 timeoutMs + opts.timeoutMs 显式覆盖
- `packages/brain/src/spawn/middleware/__tests__/resource-tier.test.js`：toEqual 加 timeoutMs 字段 + 数值排序断言

## Brain task

3f32212a-adc2-436b-b828-51820a2379e6
