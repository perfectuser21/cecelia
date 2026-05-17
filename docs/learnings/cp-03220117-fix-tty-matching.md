---
branch: cp-03220117-84c967fd-43b9-4c6b-88a8-9ceb72
date: 2026-03-22
task: P0修复 devloop-check.sh + stop-dev.sh runtime bug（精度改进）
---

# Learning: TTY 匹配精度改进 + cleanup action 消息细化

## 背景

PR #1342 修复了 6 个 P0/P1 bug，但 TTY 匹配改为"非空检查"（`-n`）而非精确的路径前缀检查，
存在 "not a tty" 字符串被误判为有效 TTY 的潜在风险。

## 根本原因

### 问题 1: TTY 非空检查不精确

```bash
# PR #1342 的方案（仍有边界问题）
if [[ -n "$_pre_lock_tty" && -n "$_PRE_TTY" ]]; then
```

`"not a tty"` 是非空字符串，若同时出现在 lock file 和当前会话，会进入 TTY 分支比较，
然后因不相等而落到 fallback，增加了一次无效匹配尝试（效率损耗）。
更准确的判断是：只有 `/dev/*` 设备路径才是有效 TTY。

### 问题 2: devloop-check.sh cleanup action 消息歧义

```bash
# 旧代码：不区分成功/失败
'{"status":"blocked","reason":"PR 已合并，正在执行 Stage 4 Ship（自动触发）","action":"等待 cleanup 完成，下次检查时自动退出"}'
```

cleanup.sh 执行失败时，Agent 收到的 action 是"等待"而非"立即执行 Stage 4"，导致卡死。

## 修复方案

### stop-dev.sh: 两处 TTY 改为 /dev/* 前缀检查

```bash
# v15.6.0: 使用 /dev/* 前缀精确判断有效 TTY 路径
if [[ "$_pre_lock_tty" == /dev/* && "$_PRE_TTY" == /dev/* ]]; then
```

### devloop-check.sh: cleanup 区分三种情况

```bash
if (cd "..." && bash "$_cleanup_script") 2>/dev/null; then
    # 成功：告知等待 Stop Hook 检测 cleanup_done
    {...,"action":"等待 Stop Hook 检测到 cleanup_done: true 并退出"}
else
    # 失败：告知立即执行 Stage 4
    {...,"action":"立即读取 skills/dev/steps/04-ship.md 并执行 Stage 4 Ship"}
fi
```

## 下次预防

- [ ] TTY 匹配统一用 `/dev/*` 前缀，不用 `-n` 非空检查
- [ ] action 消息中不出现"等待"——如果是失败情况，必须给出明确的下一步指令
- [ ] cleanup 类函数返回值要区分成功/失败，不要 `|| true` 吞掉错误
