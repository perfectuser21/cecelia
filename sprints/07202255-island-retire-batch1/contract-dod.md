# Contract DoD：孤岛退役批次1

**Task ID**: c3adb5e6-3b80-4682-8362-15ac086b06ea

---

## DoD 条目

### [BEHAVIOR] B1：n8n archive 9 个 JSON 文件物理删除

**描述**：`packages/workflows/n8n/archive/` 下 9 个 JSON 文件在文件系统中不存在。

**manual:bash 验收命令**：
```bash
for f in \
  clean-task-dispatcher.json \
  clean-feature-completion-sync.json \
  cecelia-callback-handler-v2.1.json \
  devgate-nightly-push.json \
  clean-feature-entry-checker.json \
  clean-feature-completion-sync-2.json \
  clean-completion-sync-v1.json \
  prd-executor.json \
  cecelia-launcher-v2.json; do
  [ ! -f "/workspace/packages/workflows/n8n/archive/$f" ] && echo "OK: $f 已删除" || { echo "FAIL: $f 仍存在"; exit 1; }
done
```

**预期结果**：9 行 `OK: * 已删除`，exit 0

---

### [BEHAVIOR] B2：engine harness 死簇 3 个 JS 文件物理删除

**描述**：`packages/engine/src/harness/{runner,evaluate,e2e-judge}.js` 在文件系统中不存在，且全局无任何文件引用这三个路径。

**manual:bash 验收命令**：
```bash
for f in runner.js evaluate.js e2e-judge.js; do
  [ ! -f "/workspace/packages/engine/src/harness/$f" ] && echo "OK: $f 已删除" || { echo "FAIL: $f 仍存在"; exit 1; }
done
echo "--- 引用扫描 ---"
HITS=$(grep -r "harness/runner\|harness/evaluate\|harness/e2e-judge" /workspace --include="*.js" --include="*.ts" 2>/dev/null || true)
[ -z "$HITS" ] && echo "OK: 无引用残留" || { echo "FAIL: 发现引用: $HITS"; exit 1; }
```

**预期结果**：3 行 `OK:` + `OK: 无引用残留`，exit 0

---

### [BEHAVIOR] B3：dashboard TSX 桩已删除且 index.ts 更新为直接 re-export 实现

**描述**：`TestPyramidPage.tsx` 和 `RelayProgressPage.tsx` 桩文件不存在；对应 `index.ts` 不再引用已删桩，直接 re-export `@features/core/execution/pages/` 实现。

**manual:bash 验收命令**：
```bash
[ ! -f "/workspace/apps/dashboard/src/pages/test-pyramid/TestPyramidPage.tsx" ] \
  && echo "OK: TestPyramidPage.tsx 已删除" \
  || { echo "FAIL: TestPyramidPage.tsx 仍存在"; exit 1; }

[ ! -f "/workspace/apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx" ] \
  && echo "OK: RelayProgressPage.tsx 已删除" \
  || { echo "FAIL: RelayProgressPage.tsx 仍存在"; exit 1; }

grep -q "@features/core" /workspace/apps/dashboard/src/pages/test-pyramid/index.ts \
  && echo "OK: test-pyramid/index.ts 已指向 @features/core" \
  || { echo "FAIL: test-pyramid/index.ts 未更新"; exit 1; }

grep -q "@features/core" /workspace/apps/dashboard/src/pages/relay-progress/index.ts \
  && echo "OK: relay-progress/index.ts 已指向 @features/core" \
  || { echo "FAIL: relay-progress/index.ts 未更新"; exit 1; }
```

**预期结果**：4 行 `OK:`，exit 0

---

### [BEHAVIOR] B4：dashboard build 在删除后正常通过

**描述**：`apps/dashboard` 的 `npm run build` 以 exit 0 完成，无 TypeScript 错误或 Vite bundle 错误。

**manual:bash 验收命令**：
```bash
cd /workspace/apps/dashboard && npm run build 2>&1 | tail -30
echo "Build exit: $?"
```

**预期结果**：build 输出末尾无红色错误，exit 0

---

### [BEHAVIOR] B5：n8n archive 无 JS/TS/SH 外部引用残留

**描述**：整个 repo 中无任何 JS / TS / Shell 文件通过路径或字符串引用 `n8n/archive`。

**manual:bash 验收命令**：
```bash
HITS=$(grep -r "n8n/archive" /workspace --include="*.js" --include="*.ts" --include="*.sh" 2>/dev/null || true)
[ -z "$HITS" ] && echo "OK: 0 命中" || { echo "FAIL: 发现引用: $HITS"; exit 1; }
```

**预期结果**：`OK: 0 命中`，exit 0

---

### [BEHAVIOR] B6：删除操作在独立 PR + CI 验收（不与其他批次合并）

**描述**：本批次变更在独立分支提交，PR 合并前 engine-ci 和 workspace-ci 两条 CI 均通过（status: success）。

**manual:bash 验收命令**：
```bash
# 在 PR 合并后执行
gh pr view --json statusCheckRollup | jq '.statusCheckRollup[] | select(.name | test("engine-ci|workspace-ci")) | {name, conclusion}'
```

**预期结果**：两条 CI 的 `conclusion` 均为 `"SUCCESS"`

---

## 停手条件（不得删除，必须报告）

- B5 扫描命中 **非空结果**（`n8n/archive` 有外部引用）
- B2 扫描命中 **三文件自身以外**的 harness/runner / harness/evaluate / harness/e2e-judge 引用
- 执行组 C 删除前，dashboard build 已经红（说明存在更早的 build 问题，不能归因到本次删除）

---

## 执行顺序约束

1. **先扫描（B5、B2 引用扫描），再删除**
2. 组 C 删除前必须先更新 `index.ts`，否则 build 立即断裂
3. 组 A、B 可独立并行删除，组 C 需联动 index.ts + 测试文件修复一起提交
