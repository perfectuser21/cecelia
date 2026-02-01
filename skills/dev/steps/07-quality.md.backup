# Step 7: Quality 汇总

> **只汇总，不判定** - 本地打包结账单，不是门禁
>
> Audit 已在 Step 5 完成，Test 已在 Step 6 完成，这里只汇总结果

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "in_progress" })`

---

## 职责定义（v3）

| 层 | 位置 | 类型 | 职责 |
|---|------|------|------|
| **Gate** | 本地 | 阻止型 | 过程卡口，FAIL 就停 |
| **Quality** | 本地 | **汇总型** | 打包结账单，不做判定 |
| **CI** | 远端 | 复核型 | 最终裁判，硬门禁 |

**Quality 不做**：
- ❌ 新一轮审计
- ❌ 重复 Gate 的检查
- ❌ 主观判断

**Quality 只做**：
- ✅ 汇总本地已跑过的硬结果
- ✅ 生成结账单让你一眼确认

---

## 汇总内容

### 1. 命令执行结果

| 命令 | 状态 | 时间 |
|------|------|------|
| npm run typecheck | ✅ PASS | 3s |
| npm run test | ✅ PASS | 12s |
| npm run build | ✅ PASS | 8s |

### 2. Gate 状态

| Gate | 状态 | 时间 |
|------|------|------|
| gate:prd | ✅ PASS | ... |
| gate:dod | ✅ PASS | ... |
| gate:audit | ✅ PASS | ... |
| gate:test | ✅ PASS | ... |

### 3. 元信息

- Branch: `cp-xxx`
- HEAD SHA: `abc123`
- Timestamp: `2026-01-30T10:00:00Z`
- Node: `20.10.0`

---

## 输出：quality-summary.json

```json
{
  "branch": "cp-xxx",
  "head_sha": "abc123",
  "timestamp": "2026-01-30T10:00:00Z",
  "commands": {
    "typecheck": { "status": "pass", "duration": "3s" },
    "test": { "status": "pass", "duration": "12s" },
    "build": { "status": "pass", "duration": "8s" }
  },
  "gates": {
    "prd": { "status": "pass", "file": ".gate-prd-passed" },
    "dod": { "status": "pass", "file": ".gate-dod-passed" },
    "audit": { "status": "pass", "file": ".gate-audit-passed" },
    "test": { "status": "pass", "file": ".gate-test-passed" }
  },
  "env": {
    "node": "20.10.0",
    "platform": "linux"
  }
}
```

---

## 执行流程

```bash
# 1. 汇总 Gate 状态
echo "检查 Gate 文件..."
for gate in prd dod audit test; do
  if [[ -f ".gate-${gate}-passed" ]]; then
    echo "  gate:${gate} ✅"
  else
    echo "  gate:${gate} ❌ 缺失"
  fi
done

# 2. 汇总命令结果（从之前的执行记录）
echo "检查命令执行..."
# 这些命令已在之前步骤执行过，这里只确认

# 3. 生成 quality-summary.json
node scripts/generate-quality-summary.cjs

# 4. 一次性提交
git add -A
git commit -m "chore: quality summary

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

git push origin HEAD
```

---

## 与 CI 的关系

| 检查点 | Quality (本地) | CI (远端) |
|--------|---------------|-----------|
| 职责 | 汇总已跑结果 | 独立复跑验证 |
| 信任度 | 参考 | 权威 |
| 硬门禁 | 否 | 是 |

**CI 不信 Quality 报告**，CI 自己跑：
- test / typecheck / build / lint / contract

Quality 只是让你在 PR 前"一眼确认没漏跑"。

---

## 完成后

**标记步骤完成**：

```bash
# 更新 .dev-mode 中的 Step 7 状态
sed -i 's/^step_7_quality: pending/step_7_quality: done/' .dev-mode
echo "✅ Step 7 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/08-pr.md`
2. 立即创建 PR
3. **不要**输出总结或等待确认
4. **不要**停顿

---

**Step 8：创建 PR**
