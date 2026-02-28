# Step 7: 本地验证

> 逐条执行 DoD 验证，所有项 [x] 后才能推送

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "in_progress" })`

---

## 为什么需要本地验证

```
❌ 旧流程：写完代码 → npm test（全 mock）→ PR → 上线发现 API 500
✅ 新流程：写完代码 → npm test + 逐条执行 DoD → 全部 [x] → PR（省一轮 CI）
```

---

## 执行步骤

### 7.1 跑自动化测试

```bash
# 检查 package.json 中是否有测试命令
if [[ -f "package.json" ]]; then
    HAS_TEST=$(node -e "const p=require('./package.json'); console.log(p.scripts?.test ? 'yes' : 'no')" 2>/dev/null)
    HAS_QA=$(node -e "const p=require('./package.json'); console.log(p.scripts?.qa ? 'yes' : 'no')" 2>/dev/null)
fi

# 优先用 qa（包含 typecheck + test + build）
if [[ "$HAS_QA" == "yes" ]]; then
    npm run qa
elif [[ "$HAS_TEST" == "yes" ]]; then
    npm test
else
    echo "⚠️ 没有测试命令，跳过自动化测试"
fi
```

| 结果 | 动作 |
|------|------|
| 通过 | 继续 Step 7.2 |
| 失败 | 修复代码 → 重跑 |
| 无测试命令 | 继续 Step 7.2 |

---

### 7.2 逐条执行 DoD 验证（核心）

读取当前分支的 `.dod-{branch}.md` 文件，对每条 `- [ ]` 项：

```bash
# 读取 DoD 文件
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DOD_FILE=".dod-${BRANCH}.md"
if [[ ! -f "$DOD_FILE" ]]; then
    DOD_FILE=".dod.md"
fi
```

**对每条未验证的 `- [ ]` 条目，根据 Test 类型执行：**

#### Test: tests/xxx.test.ts

```
→ 确认该测试文件存在
→ npm test 已经通过（Step 7.1 保证）
→ 标记为 [x]
```

#### Test: manual:curl ...

```bash
# 真正运行 curl 命令，检查返回值
# 示例：Test: manual:curl -s http://localhost:5221/api/foo | jq -e '.id'

<在此处执行 Test 字段中的完整命令>

# 判断结果：
# - 命令退出码 0 → 通过
# - 命令退出码非 0 → 失败
```

- **通过** → 把 DoD 文件中该行的 `[ ]` 改为 `[x]`
- **失败** → 检查原因（服务未启动？API 路径错？返回值格式不对？）→ 修复代码重试

常见失败原因排查：
```
退出码 1: jq 断言失败 → API 返回格式不对，检查 controller 代码
退出码 7: 连接被拒 → 服务未启动，docker ps 检查容器状态
退出码 22: HTTP 4xx/5xx → API 报错，查看 docker logs <容器名>
```

#### Test: manual:curl ... | grep -q ...

```bash
# 前端可达性检查
# 示例：Test: manual:curl -s http://localhost:5211/okr | grep -q 'okr-list'

<执行 Test 字段中的命令>

# 通过 → [x]
# 失败 → 检查前端 build 产物、API proxy 配置
```

---

### 7.3 确认全部 [x]

```
所有 DoD 条目检查结果：
  ✅ [x] POST /api/okr/goals 返回 200 → curl 验证通过
  ✅ [x] OKR 页面展示正常 → grep 验证通过
  ✅ [x] npm run qa 通过 → Step 7.1 验证
  ...

所有 [x]？
  ├─ 是 → 继续 Step 8（创建 PR）
  └─ 否 → 停在这里，修复未通过项，重跑 7.2
```

**不允许跳过任何 `[ ]` 项直接进入 Step 8。**

CI 的 `devgate.yml` 会检查 DoD 文件中不能有 `[ ]`，若有则 PR 被阻止合并。

---

## 完成后

**标记步骤完成**：

```bash
sed -i 's/^step_7_verify: pending/step_7_verify: done/' .dev-mode
echo "✅ Step 7 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/08-pr.md`
2. 立即创建 PR
3. **不要**输出总结或等待确认

---

**Step 8：创建 PR**
