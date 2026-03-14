---
id: learning-cp-03142149-dev-step-files
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning: /dev 6步重组新步骤文件创建（2026-03-14）

## 根本原因

创建新步骤文件（02-code.md、03-prci.md、04-learning.md、05-clean.md）时漏掉 Engine 版本 bump。Engine skills 目录下任何文件的新增或修改都属于 Engine 改动，必须同时 bump 版本（6个文件同步），否则 L2 Consistency Gate 报 "Version not updated in packages/engine/package.json" 失败。

同时，DoD 中用 `echo 'xxx' && exit 0` 作为测试命令会被 check-dod-mapping.cjs 识别为"echo 假测试"并拒绝，必须改用真实文件检查命令（如 `ls` 或 `grep -c`）。

## 下次预防

- [ ] 修改 packages/engine/skills/ 下任何文件时，立即 bump Engine 版本（6个文件：package.json、package-lock.json(engine)、根 package-lock.json 的 engine 条目、VERSION、.hook-core-version、regression-contract.yaml）
- [ ] DoD Test 命令禁止用 `echo`，改用 `ls`、`grep -c`、`bash -c "ls ..."` 等真实命令
- [ ] 提交前运行 `cat packages/engine/VERSION` 确认版本号比 main 高
- [ ] PR title 必须含 `[CONFIG]` tag（Engine skills 改动必须）
