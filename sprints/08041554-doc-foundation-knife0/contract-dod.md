# Contract DoD: 刀0 — 文档正本落地 + 三方对账闸 + docs 目录登记闸

TASK_ID: f1cd8a2e-476e-4827-a26c-5e44293d018b
生成时间: 2026-08-04

---

## 铁律覆盖情况

| 铁律编号 | 铁律内容 | 覆盖断言 | 覆盖状态 |
|---------|---------|---------|---------|
| I-1 | KERNEL_CONTEXT.md 是唯一正本，品牌文件是镜像 | ASSERT-1 | 已覆盖 |
| I-2 | 正本必须保留 HARD_RULES:BEGIN/END marker | ASSERT-1 | 已覆盖 |
| I-3 | 三方对账，任一不等 exit 1 | ASSERT-2 + FIRE-1 | 已覆盖 |
| I-4 | docs/ 一级子目录必须登记，未登记触发 CI 红 | ASSERT-3 + FIRE-2 | 已覆盖 |
| I-5 | 基线文件祖父条款，存量不拦只拦新增 | ASSERT-4 | 已覆盖 |
| I-6 | smoke 脚本放 scripts/smoke/ 即自动接线，禁新建 workflow | ASSERT-3 | 已覆盖 |
| I-7 | 本刀零依赖，不碰 Kernel/orchestrator，不改品牌文件区块内容 | 范围边界声明 | 已覆盖 |

---

## DoD 检查项（合并前逐项 tick）

### 代码产物
- [ ] `packages/workflows/KERNEL_CONTEXT.md` 存在，含 BEGIN/END marker，内容与 AGENTS.md 的 HARD_RULES 区块逐字一致
- [ ] `scripts/check-agents-rules-sync.sh` 已升级为三方对账，含 `packages/workflows/KERNEL_CONTEXT.md` 引用
- [ ] `scripts/smoke/check-docs-dir-registry-smoke.sh` 存在且 chmod +x
- [ ] `docs/current/docs-dir-baseline.txt` 存在，非空，含头注释，列出当前全部一级子目录
- [ ] `packages/engine/tests/integrity/doc-foundation-contract.test.sh` 存在

### TDD 红绿
- [ ] commit-1 仅包含契约测试，运行结果 PASS=0 FAIL=4（已在 commit message 或 PR body 留证）
- [ ] commit-2 包含全部实现，运行结果 PASS=4 FAIL=0
- [ ] 两个 commit 独立，顺序可 git log 验证

### proven-to-fire 验火
- [ ] FIRE-1 执行记录在 PR body（命令 + 输出摘录，包含 exit 1 与 ❌ 差异行）
- [ ] FIRE-2 执行记录在 PR body（命令 + 输出摘录，包含 exit 1 与 ❌ 未登记目录: docs/zzz-firecheck）
- [ ] 两次验火均已还原，无临时文件提交

### CI
- [ ] CI 全绿（brain-integration 偶发竞态可重跑）
- [ ] 无新增 workflow 文件（I-6 合规）

### 范围边界
- [ ] 无 Kernel/orchestrator 代码改动
- [ ] 无品牌文件 HARD_RULES 区块内容改动
- [ ] 无 Notion 同步链改动

---

## 验收判定标准（Final E2E）

**判定为 PASS 的充要条件**：

1. `bash packages/engine/tests/integrity/doc-foundation-contract.test.sh` 输出 `PASS=4 FAIL=0`，exit 0
2. `bash scripts/check-agents-rules-sync.sh` 输出 `✅ 三方（正本/AGENTS/CLAUDE）硬规则摘要一致`，exit 0
3. `bash scripts/smoke/check-docs-dir-registry-smoke.sh` exit 0（所有 docs/ 一级子目录已登记）
4. PR body 含 FIRE-1 和 FIRE-2 的验火截图/输出（均显示 exit 1）

**任一不满足 → 判定为 FAIL，不合并**
