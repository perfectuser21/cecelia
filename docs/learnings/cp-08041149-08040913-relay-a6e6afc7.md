# Learning — ledger-hygiene m7「自主循环零产出」探针可信化

## 运行指标

- GAN 轮次：1（contract r1 即 APPROVED，铁律覆盖 14/14）
- Evaluator Fix 次数：1（首跑 FAIL 因并发环境污染，非代码缺陷，隔离修复后全量重跑 65/65+4/4+E2E 全过）
- 总成本：$0.00（relay-runs API 对本 task 未记录成本，实际成本未采集）
- PR：https://github.com/perfectuser21/cecelia/pull/4597（MERGED，squash，merge commit 5d172969）
- Sprint Dir：sprints/08040913-relay-a6e6afc7
- 版本：brain 1.267.206

## 发现的问题

### [PROMPT] Prompt 类问题

无（本次未遇到——GAN 一轮通过、generator 未因 prompt 歧义返工）。

### [BUG] 代码缺陷

- m7 探针滑动窗秒级漂移：原探针用 NOW()-24h 滑动窗，每次 tick 执行时刻不同导致窗口边界秒级漂移，同一自然日可能重复计账或漏计 → 根因是窗口定义依赖执行时刻而非日历 → 修法：getM7CaptureWindow 确定性北京自然日窗口，边界与执行时刻解耦。
- m7 探针自指计数：守卫自产 atom（前缀 `issue: [ledger-hygiene]`）被计入"自主循环产出"，守卫报警本身抬高产出计数形成自指污染 → 修法：organic/self 分解，排除共享常量 LEDGER_SELF_ATOM_PREFIX 前缀条目，08-03 击穿场景已固化为回归测试永留 CI。

### [INFRA] 基础设施问题

- evaluator 共享 /tmp 脚本被并发 sprint 覆盖致首跑 FAIL：多 sprint 并发时 /tmp 固定路径互相踩踏 → 修法：改会话独享路径后通过；evaluator 脚本落点应默认按 session 隔离。
- judge DeepSeek 连续两次超时 fail-open：前两次超时结果不采信，第 3 次才拿到真裁决 → judge 外部依赖超时重试成本高，超时阈值/备用通道值得复盘。
- Deploy Preview Environment check 全仓性红：非 required check，多条无关 PR 同期同样 fail，属既有基础设施 flaky，与本 PR 无关（已在报告列明，避免误归因）。
- report 阶段 Brain HTTP 挂起约 1 分钟：PR 合并触发 deploy-webhook 自动部署期间容器 unhealthy、API 请求 0 字节挂起，report 各步需带 --max-time 并轮询等待恢复，否则整段脚本超时假死。

### [DESIGN] 设计缺陷

- harness 毕业步与 lint-contract-test-immutability CI 闸正面冲突：毕业 commit 删除 canonical Red 后测试树被 CI fail-closed 拦红，毕业被迫 force-push 回锚定 SHA 回退（前例 #4483 及 main 多个 sprint 均未毕业直接合并）→ 系统性冲突已立 issue a202744a。
- m7 strategist 子探针从未激活：本次范围外，已立 issue 221b228e 单独跟进。
- merge 前 update-branch 引入 BEHIND（#4601 docs-only）：轻量 rebase 走豁免不重评，verdict 重锚至 a3f958c9——豁免规则本次工作正常，但"锚定 SHA 与 merge head 不一致"的重锚动作依赖人工判断 docs-only，宜机械化。

## 下次预防清单

- [ ] evaluator 生成的临时脚本一律落会话独享路径（含 session id），禁止共享 /tmp 固定文件名，防并发 sprint 互踩。
- [ ] 探针类时间窗口一律用确定性日历窗口（自然日+时区），不用 NOW()-interval 滑动窗，防执行时刻漂移。
- [ ] 守卫/探针自产数据必须用共享常量前缀标记并在统计侧排除，防自指计数污染。
- [ ] harness 毕业步在 issue a202744a 解决前不再尝试删除合同测试树，避免与 lint-contract-test-immutability 再次冲突。
- [ ] report 阶段所有 Brain API 调用带 --max-time 并对部署窗口期做轮询重试，防 deploy-webhook 期间脚本假死。
