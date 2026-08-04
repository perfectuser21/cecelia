# Contract Draft — 刀0.5 僵尸文档清尸

**Task ID**: 35cb771b-82bf-4d24-b1c4-b7a7b40af79f
**Sprint Dir**: sprints/08041713-doc-zombie-cleanup
**决策锚点**: 6020bb14（状态快照型文档物种永久取缔）
**Proposer 日期**: 2026-08-04

---

## 一、合同范围确认

本合同约束以下变更的完成标准，不扩展到 PRD 五禁止事项之外。

### 变更分类

| 类别 | 具体项 |
|------|--------|
| 文件退役（git mv）| `.agent-knowledge/skills-index.md`、`.agent-knowledge/CURRENT_STATE.md`、`scripts/write-current-state.sh`、`scripts/__tests__/write-current-state.test.sh`、`packages/engine/tests/write-current-state.test.ts`、`packages/engine/tests/integration/cleanup-write-state.test.ts`、`packages/engine/tests/integration/current-state-format.test.ts` → `docs/archive/` |
| CI 工作流修改 | `.github/workflows/ci.yml` 删除 `write-current-state 自测` step；`.github/workflows/nightly-regression.yml` 同步删除 |
| cleanup.sh 修改 | `packages/engine/skills/dev/scripts/cleanup.sh` 删除 Section 2.6（write-current-state 调用段） |
| 幻觉引用清理 | `docs/current/README.md` 删除 3 处 PATROL-REGISTRY 引用及整节 |
| 死路径修正 | `.agent-knowledge/engine.md` 三处死路径修正为 `packages/quality/scripts/devgate/` |
| AGENTS.md 去快照化 | 删除「深度知识」节、快照行、数字引用、死链；修正 DevGate 路径 |
| Brain 注释更新 | `packages/brain/src/seven-ring-audit.js` 第 32 行；`packages/brain/src/routes/quality.js` 第 6 行 |
| registry 清理 | `docs/registry/features/engine.yml` 删除退役测试文件引用 |
| CLAUDE.md 修改 | `.claude/CLAUDE.md` 删除两个退役 @import 行 |

---

## 二、铁律（不可妥协约束）

1. **无 @import 缺失**：`.claude/CLAUDE.md` 中不得保留已退役文件的 @import 行（`@.agent-knowledge/skills-index.md`、`@.agent-knowledge/CURRENT_STATE.md`）
2. **无 PATROL-REGISTRY 引用**：`docs/current/README.md` 中零命中 `PATROL-REGISTRY` 字样
3. **write-current-state 零命中**：全仓（排除 `docs/archive/`）中对 `write-current-state` 的可运行引用为零
4. **AGENTS.md 无快照内容**：不含 `38.23.47.81:9998`、不含 `最后更新：2026-03-16`、不含具体 skill 数字（63）
5. **HARD_RULES 区块完整性**：AGENTS.md `<!-- HARD_RULES:BEGIN -->` 到 `<!-- HARD_RULES:END -->` 逐字节无变化

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期结果 |
|---|---|---|---|
| 僵尸文档清尸全量验收 | `tests/contract-behaviors.test.sh` | BEHAVIOR-1 退役文件不在原路径 / BEHAVIOR-2 @import 死链和 PATROL-REGISTRY 已清除 / BEHAVIOR-3 全仓 write-current-state 零命中 / BEHAVIOR-4 AGENTS.md 快照内容已清除 HARD_RULES 完整 / BEHAVIOR-5 engine.md 死路径已修正 / BEHAVIOR-6 CI 不含 write-current-state step / BEHAVIOR-7 cleanup.sh 不含 write-current-state 调用 | 7/7 PASS，exit 0 |

---

## E2E 验收

### 验收场景 1：退役文件不在原路径

**前提**：实施 commit 已完成  
**执行**：
```bash
test ! -f .agent-knowledge/skills-index.md && echo "PASS" || echo "FAIL"
test ! -f .agent-knowledge/CURRENT_STATE.md && echo "PASS" || echo "FAIL"
test ! -f scripts/write-current-state.sh && echo "PASS" || echo "FAIL"
test ! -f scripts/__tests__/write-current-state.test.sh && echo "PASS" || echo "FAIL"
```
**期望**：4 行全部输出 `PASS`

### 验收场景 2：@import 死链已清除

**执行**：
```bash
grep "@.agent-knowledge/skills-index.md" .claude/CLAUDE.md && echo "FAIL" || echo "PASS"
grep "@.agent-knowledge/CURRENT_STATE.md" .claude/CLAUDE.md && echo "FAIL" || echo "PASS"
```
**期望**：2 行全部输出 `PASS`

### 验收场景 3：PATROL-REGISTRY 零命中

**执行**：
```bash
grep "PATROL-REGISTRY" docs/current/README.md && echo "FAIL" || echo "PASS"
```
**期望**：输出 `PASS`

### 验收场景 4：全仓 write-current-state 零命中（archive 外）

**执行**：
```bash
result=$(grep -r "write-current-state" . \
  --exclude-dir=docs/archive \
  --exclude-dir=.git \
  --exclude="doc-zombie-retired.test.sh" \
  --exclude="contract-draft.md" \
  --exclude="contract-dod.md" \
  -l 2>/dev/null)
if [ -z "$result" ]; then echo "PASS"; else echo "FAIL: $result"; fi
```
**期望**：输出 `PASS`

### 验收场景 5：AGENTS.md 快照内容已清除

**执行**：
```bash
grep "38.23.47.81:9998" AGENTS.md && echo "FAIL" || echo "PASS"
grep "最后更新：2026-03-16" AGENTS.md && echo "FAIL" || echo "PASS"
grep "63 个 Skills" AGENTS.md && echo "FAIL" || echo "PASS"
```
**期望**：3 行全部输出 `PASS`

### 验收场景 6：AGENTS.md HARD_RULES 区块完整性

**执行**：
```bash
grep -c "HARD_RULES:BEGIN" AGENTS.md
grep -c "HARD_RULES:END" AGENTS.md
```
**期望**：两个命令各输出 `1`（区块标记各一处，未被删除）

### 验收场景 7：engine.md 死路径已修正

**执行**：
```bash
grep "node packages/engine/scripts/devgate/check-dod-mapping.cjs" .agent-knowledge/engine.md && echo "FAIL" || echo "PASS"
grep "node scripts/devgate/scan-rci-coverage.cjs" .agent-knowledge/engine.md && echo "FAIL" || echo "PASS"
grep "bash scripts/devgate/require-rci-update-if-p0p1.sh" .agent-knowledge/engine.md && echo "FAIL" || echo "PASS"
```
**期望**：3 行全部输出 `PASS`

### 验收场景 8：回归测试全绿

**执行**：
```bash
bash packages/engine/tests/integrity/doc-zombie-retired.test.sh
echo "exit: $?"
```
**期望**：exit code 0，无 FAIL 行

---

## 四、不在合同范围内

- 25 个孤儿目录归并
- Notion 链路、sprints/ 归档策略
- CI_PIPELINE/DEV_PIPELINE 内容重写（只标过期）
- Kernel/orchestrator 代码变更
- HARD_RULES:BEGIN/END 区块任何改动
