# Learning：Stop Hook 单一出口重构

## 背景
PR-2 #2826 把 stop-dev.sh 切到 v23 心跳模型（209 行 → 79 行），但仍保留了 8 个分散的 `exit 0`（早退 5 个 + block 决策 2 个 + release 1 个）。Alex 提醒"任务彻底完成应该只有 1 个 exit 0"。本 PR-2.5 把分散出口收敛到单一出口。

## 根本原因
v23 hook 写出来时还没把单一出口纪律内化进设计 —— 沿用 v22 的"早退多出口"风格，每个早退条件直接 `&& exit 0`。问题：
- 加日志要在 8 处加
- 加清理要在 8 处加
- 任何观测/审计逻辑都要追 8 条路径
- 后续维护者难一眼看出"这个 hook 究竟是 block 还是 release"

## 下次预防

### 下次预防

- [x] 单一出口模式：所有判定只 set DECISION/REASON_CODE/BLOCK_REASON 变量；唯一 exit 0 在文件末尾
- [x] CI 强 lint：`scripts/check-single-exit.sh` 加 `exit 0 = 1` 守门，永远阻止散点 exit 0 复活
- [x] 测试纪律：3 个 artifact 测试（exit 0 计数 / 末尾位置 / 无 && exit 复合早退）+ 19 个 PR-2 行为回归
- [ ] 中文全角括号 `（）` 在 bash 字符串里要用 `${VAR}` 显式分隔，否则会被吞进变量名（本次首次实现踩到，5 分钟内修掉）
- [ ] 后续任何 hook 改动遵循"决策变量 + 单一出口"模式，不能新增散点 exit 0
- [ ] 任何"x 个分散出口"的早退式代码都是单一出口纪律的反例，应主动重构

## 设计模式总结

```bash
# ❌ Bad（v23 PR-2 风格）：
[[ ! cond ]] && exit 0
... do work ...
exit 0  # 实际还有别的出口散在各处

# ✅ Good（v23.1 PR-2.5 风格）：
DECISION="release"
REASON_CODE=""

if cond_1; then REASON_CODE="x"; fi
if cond_2; then DECISION="block"; REASON_CODE="y"; fi
... 
# 唯一出口
log_decision ... && [[ DECISION=block ]] && jq ...
exit 0
```

可观测性 + 可维护性 + 单一出口纪律一处到位。
