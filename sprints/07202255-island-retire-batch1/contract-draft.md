# Contract Draft：孤岛退役批次1

**Task ID**: c3adb5e6-3b80-4682-8362-15ac086b06ea
**Sprint Dir**: sprints/07202255-island-retire-batch1
**类型**: 纯删除 / 清理（无功能变更）
**起草轮次**: 首轮

---

## 背景摘要

三组经四线验证（引用扫描 + test 覆盖 + 路由解析 + git 历史）确认为死件的文件：

- **组 A**：`packages/workflows/n8n/archive/` 9 个 N8N 史前 JSON（零引用）
- **组 B**：`packages/engine/src/harness/` 3 个 JS（runner / evaluate / e2e-judge，三文件互为死簇，engine 外零引用）
- **组 C**：`apps/dashboard/src/pages/test-pyramid/TestPyramidPage.tsx` + `apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx`（re-export 桩，runtime 指向 `@features/core/execution/pages/`）

---

## 已知约束（合同起草阶段引用扫描结论）

### 引用扫描结果（2026-07-23）

| 检查项 | 扫描命令 | 结果 |
|--------|----------|------|
| A1：n8n archive JS/TS/SH 引用 | `grep -r "n8n/archive" ... --include="*.js" --include="*.ts" --include="*.sh"` | **0 命中** ✅ |
| A2：harness runner/evaluate/e2e-judge 引用 | `grep -r "harness/runner\|harness/evaluate\|harness/e2e-judge" ...` | **0 命中** ✅ |
| A3：TestPyramidPage / RelayProgressPage 直接 import | `grep -r "from.*TestPyramidPage\|from.*RelayProgressPage" /workspace/apps/dashboard/src` | **4 命中（已知，见下）** ⚠️ |

### 组 C 引用详情（已知，不触发停手）

已知引用链路：
1. `apps/dashboard/src/pages/test-pyramid/index.ts` → `export { default } from './TestPyramidPage'` — **PRD 明确保留 index.ts，不删**
2. `apps/dashboard/src/pages/relay-progress/index.ts` → `export { default } from './RelayProgressPage'` — **PRD 明确保留 index.ts，不删**
3. `apps/dashboard/src/pages/test-pyramid/__tests__/test-pyramid.test.tsx` → `import('../TestPyramidPage')` — **测试直接引用桩文件**
4. `apps/dashboard/src/pages/relay-progress/__tests__/relay-progress.test.tsx` → `import('../RelayProgressPage')` — **测试直接引用桩文件**

**关键结论**：删除 TSX 桩文件后，`index.ts` 会因 re-export 断裂导致 build 失败，测试也会断裂。
**处理方案**：
- `index.ts` 需同步更新为直接 re-export `@features/core/execution/pages/` 实现（不在本合同删除范围，但是必要的联动修改）
- 两个测试文件需同步更新 import 路径指向真实实现（或通过 index.ts 间接 import）

---

## 变更范围

### 删除文件（FR-DEL-01 ~ 04）

**组 A（9 个 JSON，可独立删除）**：
```
packages/workflows/n8n/archive/clean-task-dispatcher.json
packages/workflows/n8n/archive/clean-feature-completion-sync.json
packages/workflows/n8n/archive/cecelia-callback-handler-v2.1.json
packages/workflows/n8n/archive/devgate-nightly-push.json
packages/workflows/n8n/archive/clean-feature-entry-checker.json
packages/workflows/n8n/archive/clean-feature-completion-sync-2.json
packages/workflows/n8n/archive/clean-completion-sync-v1.json
packages/workflows/n8n/archive/prd-executor.json
packages/workflows/n8n/archive/cecelia-launcher-v2.json
```

**组 B（3 个 JS，一并删除）**：
```
packages/engine/src/harness/runner.js
packages/engine/src/harness/evaluate.js
packages/engine/src/harness/e2e-judge.js
```

**组 C（2 个 TSX 桩）**：
```
apps/dashboard/src/pages/test-pyramid/TestPyramidPage.tsx
apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx
```

### 联动修改（保证 build 不断）

**必须同步修改（组 C 的联动变更）**：
- `apps/dashboard/src/pages/test-pyramid/index.ts` → 从 `export { default } from './TestPyramidPage'` 改为直接 `export { default } from '@features/core/execution/pages/TestPyramidPage'`
- `apps/dashboard/src/pages/relay-progress/index.ts` → 从 `export { default } from './RelayProgressPage'` 改为直接 `export { default } from '@features/core/execution/pages/RelayProgressPage'`
- 两个 `__tests__` 文件中的 `import('../TestPyramidPage')` / `import('../RelayProgressPage')` 改为通过 `./index` 或直接引用实现路径

---

## 停手条件（INV-2 铁律）

以下任一情况出现，立即停手，不执行删除，报告具体命中内容：

1. `grep -r "n8n/archive" /workspace --include="*.js" --include="*.ts" --include="*.sh" --include="*.json"` 命中**非归档目录自身**的外部引用
2. `grep -rn "harness/runner\|harness/evaluate\|harness/e2e-judge" /workspace --include="*.js" --include="*.ts"` 命中**组 B 三文件自身之外**的路径
3. 删除组 C 的 TSX 桩后，dashboard `npm run build` 出现**非预期**的 TypeScript 报错（预期中的断裂是 index.ts re-export，必须在删除前修复）

---

## E2E 验收

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT=/workspace

echo "=== [A1] 验证 n8n archive JSON 文件已删除 ==="
for f in \
  "packages/workflows/n8n/archive/clean-task-dispatcher.json" \
  "packages/workflows/n8n/archive/clean-feature-completion-sync.json" \
  "packages/workflows/n8n/archive/cecelia-callback-handler-v2.1.json" \
  "packages/workflows/n8n/archive/devgate-nightly-push.json" \
  "packages/workflows/n8n/archive/clean-feature-entry-checker.json" \
  "packages/workflows/n8n/archive/clean-feature-completion-sync-2.json" \
  "packages/workflows/n8n/archive/clean-completion-sync-v1.json" \
  "packages/workflows/n8n/archive/prd-executor.json" \
  "packages/workflows/n8n/archive/cecelia-launcher-v2.json"; do
  if [ -f "$REPO_ROOT/$f" ]; then
    echo "FAIL: 文件仍存在: $f"
    exit 1
  fi
  echo "OK: 已删除 $f"
done

echo "=== [A2] 验证 harness 三个 JS 文件已删除 ==="
for f in \
  "packages/engine/src/harness/runner.js" \
  "packages/engine/src/harness/evaluate.js" \
  "packages/engine/src/harness/e2e-judge.js"; do
  if [ -f "$REPO_ROOT/$f" ]; then
    echo "FAIL: 文件仍存在: $f"
    exit 1
  fi
  echo "OK: 已删除 $f"
done

echo "=== [A3] 验证 dashboard TSX 桩已删除 ==="
for f in \
  "apps/dashboard/src/pages/test-pyramid/TestPyramidPage.tsx" \
  "apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx"; do
  if [ -f "$REPO_ROOT/$f" ]; then
    echo "FAIL: 文件仍存在: $f"
    exit 1
  fi
  echo "OK: 已删除 $f"
done

echo "=== [A4] 验证无 n8n/archive 外部引用残留 ==="
HITS=$(grep -r "n8n/archive" "$REPO_ROOT" --include="*.js" --include="*.ts" --include="*.sh" 2>/dev/null || true)
if [ -n "$HITS" ]; then
  echo "FAIL: 发现 n8n/archive 引用残留:"
  echo "$HITS"
  exit 1
fi
echo "OK: n8n/archive 无外部引用残留"

echo "=== [A5] 验证无 harness runner/evaluate/e2e-judge 引用残留 ==="
HITS=$(grep -r "harness/runner\|harness/evaluate\|harness/e2e-judge" "$REPO_ROOT" --include="*.js" --include="*.ts" 2>/dev/null || true)
if [ -n "$HITS" ]; then
  echo "FAIL: 发现 harness 引用残留:"
  echo "$HITS"
  exit 1
fi
echo "OK: harness runner/evaluate/e2e-judge 无引用残留"

echo "=== [A6] 验证 index.ts 已更新为直接 re-export 实现（不再引用已删桩）==="
TP_IDX="$REPO_ROOT/apps/dashboard/src/pages/test-pyramid/index.ts"
RP_IDX="$REPO_ROOT/apps/dashboard/src/pages/relay-progress/index.ts"
if grep -q "from.*'./TestPyramidPage'" "$TP_IDX" 2>/dev/null; then
  echo "FAIL: test-pyramid/index.ts 仍引用已删桩文件"
  exit 1
fi
if grep -q "from.*'./RelayProgressPage'" "$RP_IDX" 2>/dev/null; then
  echo "FAIL: relay-progress/index.ts 仍引用已删桩文件"
  exit 1
fi
echo "OK: index.ts 已更新，不再引用已删桩"

echo "=== [A7] dashboard build 通过 ==="
cd "$REPO_ROOT/apps/dashboard"
npm run build 2>&1 | tail -20
BUILD_EXIT=${PIPESTATUS[0]:-$?}
if [ $BUILD_EXIT -ne 0 ]; then
  echo "FAIL: dashboard build 失败，exit=$BUILD_EXIT"
  exit 1
fi
echo "OK: dashboard build 通过"

echo ""
echo "=== 所有验收项通过 ==="
```
