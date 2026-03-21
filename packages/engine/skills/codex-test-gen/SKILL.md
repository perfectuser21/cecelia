---
name: codex-test-gen
version: 1.0.0
created: 2026-03-21
updated: 2026-03-21
description: |
  Codex 自动测试生成 skill。Brain 派发 codex_test_gen 任务时调用。
  自动扫描覆盖率低的模块并生成单元测试，提升仓库整体覆盖率。

  输入：task description（指定目标模块或覆盖率阈值，可选）
  输出：生成的测试文件 + 覆盖率报告摘要

trigger_words:
  - codex_test_gen（由 Brain executor 自动调用，不由用户手动触发）
---

# /codex-test-gen — Codex 自动测试生成 Skill

**角色**：测试生成引擎（自动调用，非用户入口）

**调用方**：Brain executor（当 task_type = codex_test_gen 时）

**执行位置**：西安 Mac mini（Codex CLI，prompt 模式）

---

## 核心定位

`codex-test-gen` 让 Codex 自主完成测试生成的完整闭环：
1. 扫描覆盖率报告，找出覆盖率低于阈值的模块
2. 读取目标模块源码，理解业务逻辑
3. 生成针对关键路径的单元测试
4. 验证生成的测试能通过

---

## 环境变量

执行时由 Brain executor 注入（可通过 task description 覆盖）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TARGET_MODULE` | 指定目标模块路径（可选） | 自动扫描 |
| `COVERAGE_THRESHOLD` | 覆盖率阈值，低于此值的模块需要补测 | 60 |
| `MAX_MODULES` | 最多处理几个模块（防止超时） | 3 |
| `BRAIN_URL` | Brain API 地址 | http://localhost:5221 |

---

## 执行流程

### Step 1: 确定目标模块

```bash
COVERAGE_THRESHOLD="${COVERAGE_THRESHOLD:-60}"
MAX_MODULES="${MAX_MODULES:-3}"

if [[ -n "$TARGET_MODULE" ]]; then
    echo "目标模块（指定）: $TARGET_MODULE"
    TARGETS="$TARGET_MODULE"
else
    echo "扫描覆盖率报告..."
    COVERAGE_FILE=$(find . -name "coverage-summary.json" -not -path "*/node_modules/*" | head -1)

    if [[ -z "$COVERAGE_FILE" ]]; then
        echo "未找到覆盖率报告，先生成..."
        npm test -- --coverage 2>/dev/null || npx vitest run --coverage 2>/dev/null
        COVERAGE_FILE=$(find . -name "coverage-summary.json" -not -path "*/node_modules/*" | head -1)
    fi

    if [[ -n "$COVERAGE_FILE" ]]; then
        TARGETS=$(node -e "
          const c = JSON.parse(require('fs').readFileSync('$COVERAGE_FILE', 'utf8'));
          const low = Object.entries(c)
            .filter(([k]) => k !== 'total')
            .filter(([k, v]) => v.lines?.pct < $COVERAGE_THRESHOLD)
            .sort((a, b) => a[1].lines?.pct - b[1].lines?.pct)
            .slice(0, $MAX_MODULES)
            .map(([k]) => k);
          console.log(low.join('\n'));
        " 2>/dev/null)
        echo "覆盖率低于 ${COVERAGE_THRESHOLD}% 的模块: $TARGETS"
    else
        echo "无法获取覆盖率报告，退出"
        exit 1
    fi
fi
```

### Step 2: 读取源码，生成测试

对每个目标模块，Codex 执行以下步骤：

1. 读取模块源码（`cat $MODULE`）
2. 确定测试文件路径（`src/foo.js` → `src/__tests__/foo.test.js`）
3. 生成覆盖关键路径的单元测试：
   - 所有导出函数的正常路径
   - 边界条件（null/undefined 输入、空数组等）
   - 关键错误路径
4. 保持与项目现有测试风格一致（vitest / jest import 风格）

### Step 3: 验证生成的测试

```bash
for TEST_FILE in $GENERATED_TEST_FILES; do
    if [[ -f "$TEST_FILE" ]]; then
        npx vitest run "$TEST_FILE" 2>&1 | tail -10
        # 如果失败，Codex 自动读取错误并修复
    fi
done
echo "测试生成完成"
```

### Step 4: 输出摘要

```
=== 测试生成摘要 ===
处理模块数: N
生成测试文件: [列表]

CODEX_TEST_GEN_RESULT: SUCCESS
```

---

## 质量要求

生成的测试文件必须满足：

1. **可运行**：`npx vitest run <test-file>` 零失败
2. **风格一致**：与现有测试文件保持相同的 import/describe/it 风格
3. **覆盖关键路径**：至少覆盖每个导出函数的正常路径
4. **不重复**：不与现有测试重复

---

## 注意事项

- 此 skill 运行在西安 Codex CLI（prompt 模式），超时设置 10 分钟
- 优先处理覆盖率最低的模块（排序后取前 MAX_MODULES 个）
- 如果模块过于复杂，只生成框架测试（描述预期行为，标注 TODO）
- 不修改源码，只添加测试文件

---

## 触发示例

```json
{
  "task_type": "codex_test_gen",
  "title": "为 packages/brain/src/task-router.js 生成测试",
  "description": "扫描 packages/brain/src/task-router.js 的测试覆盖率，补充缺失的单元测试",
  "payload": {
    "target_module": "packages/brain/src/task-router.js",
    "coverage_threshold": 50
  }
}
```
