# Step 7: Quality 汇总

> **只汇总，不判定** - 本地打包结账单，不是门禁
>
> Audit 已在 Step 5 完成，Test 已在 Step 6 完成，这里只汇总结果

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "in_progress" })`

---

## 职责定义

| 层 | 位置 | 类型 | 职责 |
|---|------|------|------|
| **Gate** | 本地 | 阻止型 | 过程卡口，FAIL 就停 |
| **Quality** | 本地 | **汇总型** | 打包结账单，不做判定 |
| **CI** | 远端 | 复核型 | 最终裁判，硬门禁 |

**Quality 不做**：
- ❌ 新一轮审计
- ❌ 重复 Gate 的检查
- ❌ 阻止流程

**Quality 只做**：
- ✅ 汇总本地已跑过的硬结果
- ✅ 生成结账单让你一眼确认

---

## 执行流程

```bash
# 1. 汇总 Gate 状态
echo "检查 Gate 文件..."
GATES_PASSED=true
for gate in prd dod test; do
  if [[ -f ".gate-${gate}-passed" ]]; then
    echo "  gate:${gate} ✅"
  else
    echo "  gate:${gate} ⏭️ 跳过或不适用"
  fi
done

# 2. 获取分支和 SHA
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
HEAD_SHA=$(git rev-parse --short HEAD)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 3. 生成 quality-summary.json
cat > quality-summary.json << EOF
{
  "branch": "$BRANCH_NAME",
  "head_sha": "$HEAD_SHA",
  "timestamp": "$TIMESTAMP",
  "gates": {
    "prd": "$([ -f .gate-prd-passed ] && echo pass || echo skipped)",
    "dod": "$([ -f .gate-dod-passed ] && echo pass || echo skipped)",
    "test": "$([ -f .gate-test-passed ] && echo pass || echo skipped)"
  },
  "note": "Quality 只汇总，不判定。CI 是最终裁判。"
}
EOF

echo "✅ quality-summary.json 已生成"

# 4. 生成 .quality-gate-passed 标记文件
touch .quality-gate-passed

# 5. 一次性提交
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

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/08-pr.md`
2. 立即创建 PR
3. **不要**输出总结或等待确认

---

**Step 8：创建 PR**
