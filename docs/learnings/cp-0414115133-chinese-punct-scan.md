## 中文全角标点炸弹扫描（2026-04-14）

### 根本原因
bash 在 set -u 或 LC_ALL 变化下，`$var，`（变量紧跟中文全角标点）可能把标点当作变量标识符一部分，触发 unbound variable。PR #2332 三次踩同类坑（worktree-manage T1 / stop-dev T2 / stop-dev T4），只修单点不扫全库 → 定时炸弹留存。本次新增 check-chinese-punctuation-bombs.sh + CI 接入 + 修 17 个文件 28 处现存雷区。

### 下次预防
- [ ] 所有新 shell 代码强制 `${var}` 显式括号；CI engine-tests 会阻挡无括号用法
- [ ] 注释里的 `$var，` 也会被扫到（conservative）— 如果是故意的可改 ASCII 标点或加 shellcheck disable
