# Contract DoD — 刀0.5 僵尸文档清尸

**Task ID**: 35cb771b-82bf-4d24-b1c4-b7a7b40af79f
**版本**: v1.0（首轮提案）

---

## [BEHAVIOR-1] 退役文件不在原路径

**描述**：`.agent-knowledge/` 目录和 `scripts/` 目录下的退役文件已通过 `git mv` 移至 `docs/archive/`，原路径不可访问。

**验收方式**: manual:bash

```bash
# 验证退役文件不在原位
FAILED=0
files=(
  ".agent-knowledge/skills-index.md"
  ".agent-knowledge/CURRENT_STATE.md"
  "scripts/write-current-state.sh"
  "scripts/__tests__/write-current-state.test.sh"
  "packages/engine/tests/write-current-state.test.ts"
  "packages/engine/tests/integration/cleanup-write-state.test.ts"
  "packages/engine/tests/integration/current-state-format.test.ts"
)
for f in "${files[@]}"; do
  if [ -f "$f" ]; then
    echo "FAIL: $f still exists at original path"
    FAILED=1
  else
    echo "OK: $f removed"
  fi
done
# 验证已到 archive
if [ -f "docs/archive/agent-knowledge-retired/skills-index.md" ]; then
  echo "OK: archive copy exists"
else
  echo "FAIL: archive copy missing"
  FAILED=1
fi
exit $FAILED
```

**期望结果**: exit code 0，所有行以 `OK:` 开头

---

## [BEHAVIOR-2] @import 死链和 PATROL-REGISTRY 引用已清除

**描述**：`.claude/CLAUDE.md` 中不含退役文件的 `@import` 行；`docs/current/README.md` 中不含 `PATROL-REGISTRY` 字样。

**验收方式**: manual:bash

```bash
FAILED=0
# 检查 @import 死链
if grep -q "@.agent-knowledge/skills-index.md" .claude/CLAUDE.md; then
  echo "FAIL: .claude/CLAUDE.md still imports skills-index.md"
  FAILED=1
else
  echo "OK: skills-index.md import removed"
fi
if grep -q "@.agent-knowledge/CURRENT_STATE.md" .claude/CLAUDE.md; then
  echo "FAIL: .claude/CLAUDE.md still imports CURRENT_STATE.md"
  FAILED=1
else
  echo "OK: CURRENT_STATE.md import removed"
fi
# 检查 PATROL-REGISTRY
if grep -q "PATROL-REGISTRY" docs/current/README.md; then
  echo "FAIL: docs/current/README.md still references PATROL-REGISTRY"
  FAILED=1
else
  echo "OK: PATROL-REGISTRY references removed"
fi
exit $FAILED
```

**期望结果**: exit code 0，3 行均以 `OK:` 开头

---

## [BEHAVIOR-3] 全仓 write-current-state 零命中（archive 外）

**描述**：除 `docs/archive/` 目录、本测试文件、合同文件外，全仓不含任何对 `write-current-state` 的引用（可运行引用归零）。

**验收方式**: manual:bash

```bash
result=$(grep -r "write-current-state" . \
  --exclude-dir=docs/archive \
  --exclude-dir=.git \
  --exclude-dir=sprints \
  --exclude="doc-zombie-retired.test.sh" \
  -l 2>/dev/null)
if [ -z "$result" ]; then
  echo "OK: zero write-current-state references outside archive"
  exit 0
else
  echo "FAIL: references found in:"
  echo "$result"
  exit 1
fi
```

**期望结果**: exit code 0，输出 `OK: zero write-current-state references outside archive`

---

## [BEHAVIOR-4] AGENTS.md 快照内容已清除，HARD_RULES 区块完整

**描述**：AGENTS.md 不含已取缔的快照内容（IP 地址、版本日期、具体 skill 计数）；HARD_RULES 区块首尾标记各一处，内容完整未被碰触。

**验收方式**: manual:bash

```bash
FAILED=0
# 检查快照内容
if grep -q "38.23.47.81:9998" AGENTS.md; then
  echo "FAIL: AGENTS.md still contains IP 38.23.47.81:9998"
  FAILED=1
else
  echo "OK: IP reference removed"
fi
if grep -q "最后更新：2026-03-16" AGENTS.md; then
  echo "FAIL: AGENTS.md still contains snapshot date"
  FAILED=1
else
  echo "OK: snapshot date removed"
fi
if grep -q "63 个 Skills" AGENTS.md; then
  echo "FAIL: AGENTS.md still contains hardcoded skill count"
  FAILED=1
else
  echo "OK: hardcoded skill count removed"
fi
if grep -q "skills-index.md" AGENTS.md; then
  echo "FAIL: AGENTS.md still links to retired skills-index.md"
  FAILED=1
else
  echo "OK: retired skills-index.md link removed"
fi
# 检查 HARD_RULES 区块完整性
begin_count=$(grep -c "HARD_RULES:BEGIN" AGENTS.md)
end_count=$(grep -c "HARD_RULES:END" AGENTS.md)
if [ "$begin_count" -eq 1 ] && [ "$end_count" -eq 1 ]; then
  echo "OK: HARD_RULES block intact (BEGIN=$begin_count END=$end_count)"
else
  echo "FAIL: HARD_RULES block corrupted (BEGIN=$begin_count END=$end_count)"
  FAILED=1
fi
exit $FAILED
```

**期望结果**: exit code 0，所有行以 `OK:` 开头

---

## [BEHAVIOR-5] engine.md 死路径已修正

**描述**：`.agent-knowledge/engine.md` 中三处死路径已修正为真实路径（`packages/quality/scripts/devgate/`）。

**验收方式**: manual:bash

```bash
FAILED=0
dead_paths=(
  "node packages/engine/scripts/devgate/check-dod-mapping.cjs"
  "node scripts/devgate/scan-rci-coverage.cjs"
  "bash scripts/devgate/require-rci-update-if-p0p1.sh"
)
for path in "${dead_paths[@]}"; do
  if grep -q "$path" .agent-knowledge/engine.md; then
    echo "FAIL: dead path still present: $path"
    FAILED=1
  else
    echo "OK: dead path removed: $path"
  fi
done
# 验证正确路径已存在
if grep -q "packages/quality/scripts/devgate/check-dod-mapping.cjs" .agent-knowledge/engine.md; then
  echo "OK: correct devgate path present"
else
  echo "FAIL: correct devgate path missing"
  FAILED=1
fi
exit $FAILED
```

**期望结果**: exit code 0，所有行以 `OK:` 开头

---

## [BEHAVIOR-6] CI 工作流不含 write-current-state step

**描述**：`.github/workflows/ci.yml` 和 `.github/workflows/nightly-regression.yml` 中不含 `write-current-state 自测` step，不会因退役脚本不存在而报错。

**验收方式**: manual:bash

```bash
FAILED=0
if grep -q "write-current-state" .github/workflows/ci.yml; then
  echo "FAIL: ci.yml still references write-current-state"
  FAILED=1
else
  echo "OK: ci.yml clean"
fi
if grep -q "write-current-state" .github/workflows/nightly-regression.yml; then
  echo "FAIL: nightly-regression.yml still references write-current-state"
  FAILED=1
else
  echo "OK: nightly-regression.yml clean"
fi
exit $FAILED
```

**期望结果**: exit code 0，2 行均以 `OK:` 开头

---

## [BEHAVIOR-7] 回归测试文件存在且全绿

**描述**：`packages/engine/tests/integrity/doc-zombie-retired.test.sh` 存在，且 5 条断言在实施完成后全部通过（exit code 0）。

**验收方式**: manual:bash

```bash
if [ ! -f "packages/engine/tests/integrity/doc-zombie-retired.test.sh" ]; then
  echo "FAIL: test file does not exist"
  exit 1
fi
bash packages/engine/tests/integrity/doc-zombie-retired.test.sh
exit_code=$?
if [ $exit_code -eq 0 ]; then
  echo "OK: all regression assertions pass"
else
  echo "FAIL: regression test exit code $exit_code"
fi
exit $exit_code
```

**期望结果**: exit code 0

---

## 完成判定

所有 7 个 [BEHAVIOR] 条目的 manual:bash 命令均 exit 0，且：
- CI `test-pyramid-guard` job 绿（不含 write-current-state step）
- CI `三方对账闸` job 绿（HARD_RULES 未被碰）
- commit 顺序：commit-1（测试先红）在前，commit-2（实施绿）在后

判定为 **DONE**。
