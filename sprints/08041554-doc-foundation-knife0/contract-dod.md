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

## E2E 验收

**判定为 PASS 的充要条件**：

[BEHAVIOR] ASSERT-1: packages/workflows/KERNEL_CONTEXT.md 存在且含 HARD_RULES:BEGIN/END marker
manual:bash test -f packages/workflows/KERNEL_CONTEXT.md && grep -q 'HARD_RULES:BEGIN' packages/workflows/KERNEL_CONTEXT.md && grep -q 'HARD_RULES:END' packages/workflows/KERNEL_CONTEXT.md && echo "PASS" || echo "FAIL"

[BEHAVIOR] ASSERT-2: scripts/check-agents-rules-sync.sh 引用正本路径 packages/workflows/KERNEL_CONTEXT.md（三方对账已升级）
manual:bash grep -q 'packages/workflows/KERNEL_CONTEXT.md' scripts/check-agents-rules-sync.sh && echo "PASS" || echo "FAIL"

[BEHAVIOR] ASSERT-3: scripts/smoke/check-docs-dir-registry-smoke.sh 存在且可执行
manual:bash test -f scripts/smoke/check-docs-dir-registry-smoke.sh && test -x scripts/smoke/check-docs-dir-registry-smoke.sh && echo "PASS" || echo "FAIL"

[BEHAVIOR] ASSERT-4: docs/current/docs-dir-baseline.txt 存在且非空
manual:bash test -s docs/current/docs-dir-baseline.txt && echo "PASS" || echo "FAIL"

[BEHAVIOR] ASSERT-5: 契约测试全部通过 PASS=4 FAIL=0
manual:bash bash packages/engine/tests/integrity/doc-foundation-contract.test.sh 2>&1 | grep -E 'PASS=4 FAIL=0' && echo "PASS" || echo "FAIL"

[BEHAVIOR] ASSERT-6: 三方对账脚本运行通过
manual:bash bash scripts/check-agents-rules-sync.sh && echo "PASS" || echo "FAIL"

**任一不满足 → 判定为 FAIL，不合并**
