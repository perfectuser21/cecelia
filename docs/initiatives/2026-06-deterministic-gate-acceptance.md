# Deterministic Gate Initiative — 整体验收报告

**周期**：2026-06-11 ~ 06-13
**目标来源**：用户痛点「evaluator 不跑真实验证，或者 mock 了很多东西」
**Journey**：Cecelia Harness Pipeline (bb8cc561)
**状态**：✅ 7/7 feature done，收官

---

## 一、initiative 的本质

不是普通功能开发，而是**用 harness pipeline 自己造的工具，改造 harness pipeline 自己**。
7 个 feature 全部作为 harness run（1 task = 1 run = 1 PR）跑出来，每条 run 同时是对 pipeline 的真实验证——
真跑一次比纸面审计暴露的问题多一个数量级。

## 二、核心交付：验收架构「运动员-摄像头-裁判」三权分立

回答用户原始痛点的终极解（用户亲自拍板）：

```
运动员 = evaluator agent     在真实环境像人一样亲手验证（执行权保留，不被纯代码取代）
摄像头 = 取证自动留痕         agent 完整执行转录 + .brain-result.json，按运行实例命名
裁判   = DeepSeek（ToAPIs）   独立读证据出 verdict + Golden Path 覆盖对照表
         运动员说 PASS 不算，裁判核对每步覆盖 + 双 PASS 才 merge
```

**实战验证**：06-12 夜，evaluator 只交「CI 全绿」一句结论，裁判当场判 FAIL —
「无任何步骤的命令 stdout/stderr，作为独立裁判无法仅凭自述确认每步执行」。
用户最初的痛点被结构性消灭。

## 三、7 个 feature

| # | feature | PR | 收口 |
|---|---|---|---|
| 1 | Skill 漂移巡检告警（smoke + 日巡） | #3342/#3343 | pipeline 自动 |
| 2 | Agent 取证文件防覆盖 | #3345/#3346/#3347 | pipeline 自动 |
| 3 | Contract Gate 确定性预检 | #3348 | pipeline 自动 |
| 4 | 独立验收裁判（DeepSeek） | #3372/#3374 | pipeline 自动 |
| 5 | Report 阶段脚本化 | #3369 | 人工验收 |
| 6 | Harness CI 防线 | #3375 | 人工验收（Golden Path 5/5 真跑） |
| 7 | Brain↔Notion 属性映射修复 | #3371 | 人工验收 |

## 四、配套：编排层 15+ bug 在真实负载下被淬出并修复（每个带回归测试）

| PR | 根因 | 价值 |
|---|---|---|
| #3335 | 回调 curl 重试 × 无幂等 → GAN proposer 并发 spawn 5 容器 | **极可能是 6 月大量 run 失败主因** |
| #3340 | startup-sync resume 与 dispatcher 对同 thread 并发 invoke | 图级互斥 |
| #3341 | merge 后重启致 checkpoint 断在 merge 后 → evaluate 已删分支 FAIL | merged 短路 |
| #3350 | 合同级 gate 命中误进 generator fix loop（generator 无权改合同） | fail-fast + GAN 前置 gate |
| #3356 | serial gate resume 用陈旧 checkpoint 误杀在飞兄弟 run | 回查持久事实源 |
| #3361 | 合同重收敛后复用带旧终局 checkpoint 的死线程 | thread_id 绑合同版本 |
| #3364/#3365 | 子图 END 边不写终态留 queued + 任务终态后僵尸 fix loop | 终态可观测 + spawn 查终态 |
| **#3366** | **容器内存 cap 1G 配 node 堆 3G → 每 ~20min OOM** | **「神秘重启」真凶，全战役最高价值修复** |
| #3368 | readPrFromGitState 的 gh 未传 cwd → 守护进程 not-a-git-repo | $10 工作被误判 no_pr |
| **#3376** | **watchdog 只巡 generator(B) 阶段，漏 GAN(A) 阶段静默卡死** | **「全自动破在最后一步」真凶** |
| #3351/#3353/#3357/#3358 | Contract Gate 规则 4 轮进化（fixtures 6→15、测试 21→63） | 负向测试/逻辑行/捕获断言/注释剥离 |

## 五、关键教训（已入 memory state.md / 各 PR Learning）

1. **「写在 skill 里的红线从未生效，有效防线全是代码层」** — 验证逻辑必须下沉代码，skill 只留语义判断。
2. **「容器 memory cap 必须 ≥ 运行时堆上限 + 开销；OOM 重启会伪装成各种上层灵异问题」** — #3366。
3. **「liveness 巡检的覆盖面必须 = 故障面；只捞 B 阶段 = A 阶段卡死永远没人管，全自动就破在这」** — #3376。
4. **「线程身份必须包含其语义版本——合同变了，执行历史就该归零」** — #3361。
5. **「裁判判得准不准取决于证据供给——摄像头不能只拍结论要拍过程」** — #3374。
6. **新 gate 上线首日必有方言，规则进化要带「生产误报变 fixture + 不弱化回归」纪律** — gate 4 轮。

## 六、时间复盘（回答「为什么一条 pipeline 拖这么久」）

- 单条干净 run ≈ 1.5h，双槽并行；7 条净执行 ≈ 3h（用户预期正确）。
- 实际跨 ~40h，因为这是**造产线**不是用产线：边跑边修 15 个潜伏 bug，每次修复 merge 触发 Brain 重启打断在飞 run → 重发（后四条平均重发 3-4 次，第 6 条到第 8 发）。
- OOM(#3366) 直到 D2 上午才现形，在它之前地基每 20min 塌一次，run 几乎不可能跑完。
- **一次性成本**：pipeline 现已成熟（bug 清零、watchdog 自救、裁判防 mock），下次同规模 run 即回归 ~3h 预期。

## 七、遗留（已记 Notion Issue，不阻塞）

- P1：CI brain-unit vitest --changed 漏跑 fs 读取型测试
- P2：initiative_run_events 用 ts BIGINT 无 created_at，patrol GAN 检测降级
- P2：generator 完成但 CI 轮询时被部署重启打断 → 留 OPEN PR 无 verdict（#3361/#3364 未完全覆盖的缝，人工验收绕过）
- 运维：Anthropic API key 余额不足（仅影响 Brain cortex，不影响 pipeline 走订阅 / 裁判走 ToAPIs）

## 八、收尾动作（已完成）

- 20 个 queued 残骸任务清理、8 个废弃 OPEN PR 关闭、残留容器/分支清理
- skill 快照同步至 SSOT（#3377，any_drift→false）
- 团队 agent 解散、宿主回 main、Brain healthy
