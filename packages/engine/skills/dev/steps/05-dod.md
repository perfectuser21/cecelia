# Step 5: DoD

> 定义验收标准（Definition of Done）— 基于探索结果，更准确

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "in_progress" })`

---

## 流程（简化版）

```
探索结果 + PRD → DoD 草稿 → DoD 定稿 → 继续
```

**CI 会检查**：每条 DoD 条目是否有 Test 字段（check-dod-mapping.cjs）

---

## Step 5.1: DoD 草稿

把 PRD 里的"成功标准"变成可勾选的清单：

```
PRD 成功标准: "用户能登录"
    ↓
DoD 草稿:
  - [ ] 用户输入正确密码能登录成功
        Test: tests/auth.test.ts
  - [ ] 用户输入错误密码显示错误提示
        Test: tests/auth.test.ts
```

---

## Step 5.2: DoD 定稿

为每个 DoD 条目指定 Test 字段：

```markdown
# DoD - <功能名>

## 验收标准

### 功能验收
- [ ] 用户输入正确密码能登录成功
      Test: tests/auth.test.ts
- [ ] POST /api/okr/goals 返回 200 且包含 goal_id 字段
      Test: manual:curl -s -X POST http://localhost:5221/api/okr/goals -H "Content-Type: application/json" -d '{"title":"test"}' | jq -e '.goal_id'
- [ ] OKR 页面正常展示目标列表（.okr-list 元素存在）
      Test: manual:curl -s http://localhost:5211/okr | grep -q 'okr-list'

### 测试验收
- [ ] npm run qa 通过
      Test: contract:C2-001
```

---

## DoD 模板

```markdown
# DoD - <功能名>

## 验收标准

### 功能验收
- [ ] <功能点 1>
      Test: tests/...
- [ ] <API 端点> 返回 <期望状态码> 且包含 <期望字段>
      Test: manual:curl -s -X <METHOD> http://localhost:<PORT>/<path> | jq -e '<assertion>'
- [ ] <前端页面> 正常展示 <内容>
      Test: manual:curl -s http://localhost:<PORT>/<page> | grep -q '<selector>'

### 测试验收
- [ ] npm run qa 通过
      Test: contract:C2-001
```

### Test 字段格式说明

| 格式 | 场景 | 优先级 | 示例 |
|------|------|--------|------|
| `tests/xxx.test.ts` | 自动化单元测试 | ⭐⭐⭐ 最优 | `tests/auth.test.ts` |
| `contract:RCI-ID` | 回归契约验证 | ⭐⭐ 次优 | `contract:C2-001` |
| `manual:<命令>` | 真实可执行命令 | ⭐ 最后 | 见下方规则 |

### manual: 格式规则（必读）

**manual: 必须包含可执行的验证命令，不允许模糊描述。**

| 变更类型 | 要求 | 示例 |
|----------|------|------|
| API 变更 | curl 命令 + jq/grep 断言 | `manual:curl -s http://localhost:5221/api/foo \| jq -e '.id'` |
| 前端变更 | curl 检查可达 + 关键元素 | `manual:curl -s http://localhost:5211/page \| grep -q 'key-class'` |
| 数据库变更 | psql 查询断言 | `manual:psql $DATABASE_URL -c "SELECT count(*) FROM foo" \| grep -q ' 1'` |

**禁止写法**（check-dod-mapping.cjs 会拦截）：
```
Test: manual:TODO              ← 禁止占位符
Test: manual:截图验证          ← 禁止模糊描述（无命令）
Test: manual:手动看一下        ← 禁止无法执行的描述
```

**选择原则**：能自动化测试的优先自动化，其次引用回归契约，最后才用 manual（必须带真实命令）。

---

## CI DevGate 检查

**PR 提交后，CI 会自动检查**（scripts/devgate/check-dod-mapping.cjs + devgate.yml）：

1. 每条 DoD 条目必须有 Test 字段
2. Test 引用的文件/RCI 必须存在
3. Manual 命令不能是 TODO/占位符/无法执行的描述
4. **所有验收项必须是 [x]（已验证），不允许 [ ]（未验证）**

**失败示例**：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DoD ↔ Test 映射检查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ❌ L15: 功能 A 正常工作
     → 缺少 Test 字段

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌ 映射检查失败
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

exit 1  ← CI 失败，阻止合并
```

---

## 完成后

**标记步骤完成**：

```bash
sed -i 's/^step_5_dod: pending/step_5_dod: done/' .dev-mode
echo "✅ Step 5 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/06-code.md`
2. 立即开始写代码
3. **不要**输出总结或等待确认

---

**Step 6：写代码**
