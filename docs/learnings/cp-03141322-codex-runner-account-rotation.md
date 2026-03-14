---
id: learning-codex-runner-account-rotation
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning: Codex Runner 账号轮换

## 问题

codex-bridge 为每个 `codex_dev` 任务只选一个账号，传给 runner.sh 的 `CODEX_HOME`。runner.sh 整个生命周期（最多 10 轮）都用同一个账号。gpt-5.4 在处理复杂长 prompt（完整 /dev 工作流 + PRD 内容）时容易触发 `Quota exceeded`，10 轮全部失败，任务整体失败。

## 解法

**runner.sh v2.3.0** 新增 `CODEX_HOMES` 环境变量（冒号分隔的多账号路径）：

1. 解析 `CODEX_HOMES` 为账号数组，`CODEX_HOME` 降级为单账号兼容
2. 每轮执行后检测输出是否含 `Quota exceeded`（大小写不敏感）
3. 若检测到：调用 `switch_to_next_account()` 切换下一个账号，本轮不计入重试次数
4. 所有账号耗尽才真正失败

**codex-bridge（infrastructure）** 调用 `executeRunner` 时需传入所有账号路径：

```javascript
// 构建 CODEX_HOMES：所有可用账号的路径，冒号分隔
const allAccounts = ['/Users/jinnuoshengyuan/.codex-team1',
  '/Users/jinnuoshengyuan/.codex-team2', ...];
const codexHomes = allAccounts.join(':');
// 在 env 中传入
env = { ...env, CODEX_HOMES: codexHomes };
```

## 规则

- `CODEX_HOMES` 优先于 `CODEX_HOME`（向后兼容）
- Quota exceeded 检测不区分大小写（`grep -qi`）
- 切换账号时 `RETRY_COUNT--`（本轮不计入），避免轮换浪费重试机会
- bridge 侧需独立 PR 更新（infrastructure 仓库）
