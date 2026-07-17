# Learning：产能判定合并（beeba317，PR #4055）

## 收获

### 根本原因

1. **纸面满机器空转**：派发闸数 in_progress 任务数，但任务生命周期一半以上在等 CI/merge——容器已退内存归零仍占并发位。计数信号选错了实体：该数"活执行体"（容器），不是"任务状态"。
2. **cap 常数病**：MAX_CONCURRENT_HARNESS_INITIATIVES=2 是猜出来的数，不随资源/账号变化。换成动态函数 min(内存余量÷档位, 账号数×并发, 硬顶) 后，加账号=池里加一行 cap 自动涨。
3. **判定收权前置病**：产能判定散在 dispatcher/slot-allocator/quota-guard/tokenPressure 四处，初版设计还差点新写第五套 Claude 额度闸——考古必须先于设计，收编优先于新建。
4. **单测碰真机**：scheduler-jobs 单测未 mock disk-guard，真实 handler ssh 逃逸宿主扫 worktree——CI ubuntu 上 ssh 快速失败假绿，本地 30s 超时才暴露。
5. **Gate3 假跳过第3型**：deploy webhook 撞 409 被当"变更已含"；deploy-local.sh SHA 对账先于 fetch → 陈旧 SHA 判无改动假 success（已立案 Notion 54a7ddc7）。

### 下次预防

- [ ] 并发/产能类闸门：先问"数的是什么实体"——占资源的实体（容器/进程）才是信号，状态字段是纸面
- [ ] 任何 cap/阈值常数：写下"它是从什么算出来的"；答不上来=常数病，改函数
- [ ] 动 dispatcher 判定链前：全仓 grep 所有 mock 该模块的测试文件一次性补桩（本次挤了 3 轮牙膏才全扫）
- [ ] 单测新增 job/handler 挂 scheduler：凡 handler 碰 exec/ssh/docker 必须在注册表测试里 mock（禁单测碰真机，案底 +1）
- [ ] merge 后盯部署必须对 `git_sha` 回读，不信 deploy status=success（2.7s success=必假）
