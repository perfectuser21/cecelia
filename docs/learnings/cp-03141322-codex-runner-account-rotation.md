---
id: learning-codex-runner-account-rotation
version: 1.1.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.1.0: 修复 Learning 格式（补充根本原因/下次预防章节）
  - 1.0.0: 初始版本
---

# Learning: Codex Runner 账号轮换（2026-03-14）

## 问题背景

codex-bridge 为每个 `codex_dev` 任务只选一个账号传给 runner.sh。runner.sh 在整个生命周期（10 轮）都用同一账号。gpt-5.4 处理复杂长 prompt 时触发 `Quota exceeded`，10 轮全部失败。

### 根本原因

runner.sh 设计为单账号模式（`CODEX_HOME` 单路径），bridge 选好账号后固化传入。遇到 quota 超限时没有切换机制，只能等重试，而重试依然用同一账号，必然再次失败。5 个账号的算力资源完全没有被充分利用。

### 下次预防

- [ ] 所有外部 API 执行层（runner）必须支持账号/凭据池，不能依赖单一账号
- [ ] bridge 在构建执行环境时，优先传入全部账号路径（`CODEX_HOMES`），而非单个
- [ ] DoD Test 命令必须用相对路径（相对于仓库根目录），不能写 worktree 绝对路径
- [ ] Engine 代码变更必须同步 bump 版本（6 个文件），否则 L2 Consistency 失败

## 解法

**runner.sh v2.3.0** 新增 `CODEX_HOMES` 环境变量（冒号分隔的多账号路径）：

1. 解析 `CODEX_HOMES` 为账号数组，`CODEX_HOME` 降级为单账号兼容
2. 每轮执行后检测输出是否含 `Quota exceeded`（大小写不敏感）
3. 若检测到：调用 `switch_to_next_account()` 切换下一个账号，本轮不计入重试次数
4. 所有账号耗尽才真正失败

**codex-bridge（infrastructure）** 调用 `executeRunner` 时传入所有账号路径：

```javascript
const codexHomes = allTeamAccounts.map(a => a.codexHome).join(':');
env = { ...env, CODEX_HOMES: codexHomes };
```

## 关键规则

- `CODEX_HOMES` 优先于 `CODEX_HOME`（向后兼容）
- Quota exceeded 检测不区分大小写（`grep -qi`）
- 切换账号时 `RETRY_COUNT--`（本轮不计入），避免轮换浪费重试机会
