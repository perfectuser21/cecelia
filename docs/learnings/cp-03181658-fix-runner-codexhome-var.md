# Learning: 修复 runner.sh $CODEX_HOME） 变量边界 bug

**分支**: cp-03181658-fix-runner-codexhome-var
**日期**: 2026-03-18

## 问题描述

Codex runner 在西安 Mac mini M4（bash 3.2 + LANG=en_US.UTF-8 + set -u）下，
team1 quota 超额后账号切换逻辑崩溃，后续所有 Codex 任务失败。

## 根本原因

`packages/engine/runners/codex/runner.sh` 第 331、432、445 行使用了：

```bash
echo "...（$CODEX_HOME）"
```

其中 `）` 是全角括号（UTF-8: `\xef\xbc\x89`）。在 bash 3.2 + `LANG=en_US.UTF-8` + `set -u` 环境下，
bash 3.2 将 `\xef\xbc\x89` 字节序列当作变量名的一部分，尝试展开不存在的变量 `CODEX_HOME）`，
触发 `unbound variable` 报错，脚本以 exit 1 崩溃。

**验证命令**：
```bash
LANG=en_US.UTF-8 /bin/bash -c 'set -u; CODEX_HOME=/tmp; echo "$CODEX_HOME）"'
# 输出: /bin/bash: CODEX_HOME）: unbound variable
```

## 修复方案

将三处 `$CODEX_HOME）` 改为 `${CODEX_HOME}）`，用花括号明确变量边界：

```bash
# 修复前
echo "...（$CODEX_HOME）"

# 修复后
echo "...（${CODEX_HOME}）"
```

## 下次预防

- [ ] 在含有全角标点的字符串中，所有变量引用必须用 `${VAR}` 花括号形式
- [ ] 新增 bash 脚本时检查是否有全角字符紧跟变量展开
- [ ] runner.sh 的 echo 语句应统一使用 `${VAR}` 格式，避免多字节边界歧义
