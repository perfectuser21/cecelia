## coding workflow 第三刀：build 写代码 + verify 独立验收（2026-10-08）

### 根本原因

- 前两刀的链只到"想清楚并开 PR"，代码是否真的写完、是否真的达成验收，全靠干活方自述；干活与判分不分开，自述就是唯一证据。
- claude 子进程的进程组/超时/取消/越界写逻辑写死在 spec.mjs 里，build/verify 要用就只能复制三份，任何一处修复都会漂移。
- md 链校验把 01/02 两个文件硬编码在代码里，加一步就要改控制流；chain_check 不知道"本次应该有哪些文件"。
- 通用执行器的 finalize 语义是主链失败后仍执行：verify 判 FAIL 时 report 依然会跑，只能靠 pr_url 缺失自然短路，不能假设 finalize 只在成功时出现。

### 下次预防

- [ ] 判分方必须是独立会话，只给验收条目与真实仓库，不给干活方的自述文件
- [ ] 验收结论由程序按结构化 verdict 判定，模型只负责取证（command + output 必须非空）
- [ ] 新增 claude 类活动一律复用 lib/claude.mjs，不复制子进程处理逻辑
- [ ] 加链文件只改 md-chain 的 CHAIN 数据表，并在 chain_check 的上下文键里登记
- [ ] 会叠加副作用（提交）的活动 max_attempts 设 1，失败交人处理而不是自动重试
- [ ] 端到端用例要同时覆盖成功路径与"中途 FAIL 时 finalize 仍执行"路径
