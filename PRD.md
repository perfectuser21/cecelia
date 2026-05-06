# PRD — fix(brain): macOS fleet 内存压力误读修复

## 背景 / 问题

`packages/brain/src/routes/infra-status.js:collectLocalStats` 用 `(totalMem - freeMem) / totalMem` 算 memory.usagePercent。这个算法在 Linux 上语义正确，但**在 macOS 上系统性误判**：

- macOS 的 `os.freemem()` 只返"立即可用 free pages"
- inactive + compressor 不算 free 但实际可让位给新进程
- 结果：macOS 上 used% 长期 95%+，跟系统真实压力无关

**实测对比**（本机 Apple M4，16G 内存）：
- 旧算法：`99.5%` used
- macOS 官方 `memory_pressure` 命令：`45%` used（free 56%）

`fleet-resource-cache.js:38` 用这个 usagePercent 算 `effectiveSlots = floor(physical * (1 - max(cpu, mem)))`，导致**美国本机 effective_slots 长期为 0**，dispatcher 派不出任何需要本机的 dev task。这是个 **bootstrap 死锁**——修复这个 bug 的 task 自己也派不出去。

## 成功标准

- **SC-001**: 美国本机（darwin）跑 `collectLocalStats()` 时，memory.usagePercent 用 `memory_pressure` 命令的真实压力，而非 `os.freemem` 误读
- **SC-002**: macOS 上 `memory_pressure` 命令失败/超时/解析失败时，自动 fallback 到 `os.freemem` 旧算法（不破坏现有行为）
- **SC-003**: 非 darwin 平台（Linux/CI）行为完全不变（保留 `os.freemem` 算法）
- **SC-004**: 美国本机部署后 `effectiveSlots > 0`（至少有 1 个 slot 可派）

## 范围限定

**在范围内**：
- 新增 `readMacOSMemoryUsagePercent()` 解析 `memory_pressure` 命令输出
- 在 `collectLocalStats` 里 darwin 分支用新算法 + fallback
- 单元测试覆盖 7 个分支（正常 / 极端 / 异常输出 / 命令失败 / 越界）

**不在范围内**：
- 远端机器（西安 Mac mini）的 macOS 压力——仍用 `collectRemoteUnixStats`，本 PR 不动
- CPU usage 算法——cpuUsage 用 loadAvg 在 macOS 上语义可议但本 PR 不修
- swap 使用率作为压力指标——本 PR 不引入

## DoD（验收）

- [x] [ARTIFACT] `packages/brain/src/routes/infra-status.js` 含 `readMacOSMemoryUsagePercent` 函数 export
- [x] [ARTIFACT] `packages/brain/src/__tests__/macos-memory-pressure.test.js` 新增测试文件
- [x] [BEHAVIOR] tests/integration/macos-memory-pressure: 7 个 case 全过（正常 56%/0%/100% + 无字段 + 抛错 + 越界 + 真实输出片段）— 本地用 `node /tmp/verify-macos-mem-pressure.mjs` 7/7 通过；CI 跑 vitest 跑测试文件
- [x] [BEHAVIOR] 实测对比：旧算法 99.5% vs 新算法 45%（差 54.5 pct，bug 严重程度证实）

## 受影响文件

- `packages/brain/src/routes/infra-status.js` — 新增 `readMacOSMemoryUsagePercent`，`collectLocalStats` darwin 分支接入
- `packages/brain/src/__tests__/macos-memory-pressure.test.js` — 新增测试文件

## 部署后验证

merge 到 main 后：
1. Brain 自动重启拿新代码（或手动重启）
2. fleet cache 30 秒内重新采样
3. `curl localhost:5221/api/brain/capacity-budget | jq '.fleet[] | select(.id=="us-mac-m4")'` 应该看到 `effective_slots > 0`
4. queued harness_initiative 任务（b10de974-...）将在下一次 tick 被派发
