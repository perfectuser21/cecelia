# Learning: /dev pipeline 5项补强

> Branch: cp-03222011-dev-pipeline-5patch
> Date: 2026-03-22
> Task: eb41b188-78ad-469d-95a5-98bf7ffde1ed

---

## 改动摘要

补强 /dev pipeline 的5个系统性断链：

1. **CI失败无记录**：Stage 3 CI失败时写入 `.dev-incident-log.json`，Stage 4 Learning 现在能读到真实失败历史
2. **PRD格式无本地验证**：Stage 1 自检新增本地运行 `check-prd.sh`，PRD bullet ≥2条在本地被拦截
3. **并行PR重叠无提示**：Stage 3 commit前扫描 open PR，检测文件重叠，输出 ⚠️ warning
4. **code_review_gate 信息卫生缺失**：新增维度 H，检测引用已删除功能/路径和同一概念矛盾描述

---

### 根本原因

**断链1（incident-log）**：Stage 4 Learning 读取 `.dev-incident-log.json`，但 Stage 3 从未写入。这是一条"设计上存在但实现上为空"的数据管道。每次CI失败都是哑的，Learning只能依赖人工输入。

**断链2（PRD格式）**：`check-prd.sh` 只在 CI L1 跑，本地 Stage 1 无镜像。导致格式错误要等 push 后才被发现（PR #1371之前曾因此失败）。

**断链3（并行PR）**：PR #1366 squash-merge 从预PR#1367快照合并，静默覆盖了已合并的内容。事后才发现没有任何预防机制。

**断链4（信息卫生）**：code-review-gate 7个维度均面向代码层，无文档信息层检查。过时路径、已删除功能引用可以无障碍进入代码库。

---

### 下次预防

- [ ] Stage 1 自检完成后 → `check-prd.sh` 立即运行，不等 CI
- [ ] Stage 3 CI失败时 → `.dev-incident-log.json` 自动追加，Stage 4 Learning 直接读取
- [ ] commit 前 → 并行PR重叠扫描（warning-only，不阻塞）
- [ ] code_review_gate → 维度H覆盖信息卫生，防止旧路径/删除功能重新出现在文档中
- [ ] 遇到 `packages/workflows/` 下编辑时 → 同步复制 PRD/Task 到该目录（branch-protect 就近检测）

---

### 关键教训

**设计文档≠运行时行为**：`.dev-incident-log.json` 的读取方已记录在 Stage 4，但写入方 Stage 3 一直缺席。这类"读者存在，写者缺失"的断链很隐蔽，必须从写者端验证。

**并行PR保护是 warning 而非 blocker**：因为并行PR有时是合理的（互不影响的文件）。保留人工判断空间，只提示不阻断。

**`packages/workflows/` 双写规则**：branch-protect.sh 就近检测 PRD，修改 workflows 子目录时必须在 `packages/workflows/` 也放一份 PRD/Task。
