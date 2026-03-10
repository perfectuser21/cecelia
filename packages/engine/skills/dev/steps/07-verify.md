# Step 7: 本地验证

> 逐条执行 DoD 验证，所有项 [x] 后才能推送

**Task Checkpoint**: `TaskUpdate({ taskId: "7", status: "in_progress" })`

---

## 为什么需要本地验证

```
❌ 旧流程：写完代码 → npm test（全 mock）→ PR → CI 调试（30min×N次）
✅ 新流程：写完代码 → npm test + local-precheck + DoD 验证 + 代码审查 → 全部 [x] → PR（CI 直通）
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
| 通过 | 继续 Step 7.1b |
| 失败 | **记录 incident** → 修复代码 → 重跑 |
| 无测试命令 | 继续 Step 7.1b |

**测试失败时，必须立即记录到 `.dev-incident-log.json`**：

```bash
append_incident() {
    local type="$1"
    local description="$2"
    local error_snippet="$3"
    local resolution="$4"

    INCIDENT_FILE=".dev-incident-log.json"
    ENTRY=$(jq -n \
        --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg step "7-verify" \
        --arg type "$type" \
        --arg desc "$description" \
        --arg err "$error_snippet" \
        --arg res "$resolution" \
        '{timestamp: $ts, step: $step, type: $type, description: $desc, error: $err, resolution: $res}')

    if [[ -f "$INCIDENT_FILE" ]]; then
        jq --argjson e "$ENTRY" '. += [$e]' "$INCIDENT_FILE" > /tmp/incident_tmp.json && mv /tmp/incident_tmp.json "$INCIDENT_FILE"
    else
        jq -n --argjson e "$ENTRY" '[$e]' > "$INCIDENT_FILE"
    fi
}
```

---

### 7.1b 本地预检（Pre-Push Gate）⭐

> **本地门禁核心步骤。** 必须在 push 之前运行，拦截最常见的 CI 失败原因。

```bash
bash scripts/local-precheck.sh
```

**该脚本自动执行（仅 Brain 改动时）**：
- `[1/3] facts-check` — DEFINITION.md 与实际代码一致性
- `[2/3] version-sync` — package.json / DEFINITION.md / .brain-versions 三方同步
- `[3/3] manifest-sync` — brain-manifest.generated.json 与源码一致

| 结果 | 动作 |
|------|------|
| 全部通过（exit 0）| 继续 Step 7.2 |
| 任意失败（exit 1）| **立即修复**，不允许带着预检失败继续 push |
| Brain 无改动（自动跳过）| 继续 Step 7.2 |

**失败时的修复模式**：
```
facts-check 失败  → 更新 DEFINITION.md 使其与源码一致
version-sync 失败 → 同步更新 DEFINITION.md 和 .brain-versions 的版本号
manifest-sync 失败 → 运行 node packages/brain/scripts/generate-manifest.mjs
```

**⛔ 禁止**：预检失败后绕过继续 push。CI 同样会运行这些检查，push 必然失败。

---

### 7.2 逐条执行 DoD 验证（核心）

读取当前分支的 `.dod-{branch}.md` 文件，对每条 `- [ ]` 项：

```bash
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
<执行 Test 字段中的命令>
# 通过 → [x]
# 失败 → 检查前端 build 产物、API proxy 配置
```

#### Test: manual:chrome:...（视觉截图验证）

`manual:chrome:` 是视觉需求的唯一验证方式，不是 shell 命令——AI 直接执行截图并视觉判断。

**格式**：`manual:chrome:screenshot <断言描述> at <URL>`

**执行流程**：
```
1. 解析断言：提取 URL 和视觉断言
2. 调用 /chrome skill 截图
3. 视觉判断：位置/可见/交互
4. 满足 → [x]，不满足 → 修复代码 → 重新截图
```

**注意**：`manual:chrome:` 不是 shell 命令，AI 必须亲自截图判断，不能跳过或用 curl|grep 替代。

---

### 7.3 确认全部 [x]

```
所有 DoD 条目检查结果：
  ✅ [x] POST /api/okr/goals 返回 200 → curl 验证通过
  ✅ [x] OKR 页面展示正常 → grep 验证通过
  ✅ [x] npm run qa 通过 → Step 7.1 验证
  ...

所有 [x]？
  ├─ 是 → 继续 Step 7.4（代码审查）
  └─ 否 → 停在这里，修复未通过项，重跑 7.2
```

**不允许跳过任何 `[ ]` 项直接进入 Step 7.4。**

CI 的 `devgate.yml` 会检查 DoD 文件中不能有 `[ ]`，若有则 PR 被阻止合并。

---

### 7.4 Subagent 并行代码审查（始终执行）

> DoD 全部 [x] 后，启动 3 个 code-reviewer subagent 并行审查本次变更

**目标**：在推送前发现代码质量问题，省一轮 CI 和人工 review 的来回。

**⚠️ 不再有跳过条件。无论变更大小，7.4 始终执行。**

原因：修复性小提交（版本号、DEFINITION.md 等）恰恰最容易引入隐蔽错误，不应跳过审查。

#### 准备审查上下文

```bash
git diff --name-only main...HEAD    # 变更文件列表
git diff main...HEAD                 # 完整 diff
```

#### 启动 3 个 Reviewer（同一消息并行发出）

```
Reviewer 1 — 简洁性 & DRY:
  subagent_type: Explore
  prompt: |
    审查以下文件的代码变更（对比 main 分支）：
    变更文件：{文件列表}

    聚焦审查：
    1. 是否有重复代码可以提取为公共函数
    2. 是否有不必要的复杂度
    3. 是否有死代码（未使用的变量/函数/import）
    4. 函数/组件是否过长（>50行考虑拆分）

    对每个问题给出：文件路径 + 行号 + 具体建议。
    如果代码质量良好，说"未发现简洁性问题"。
    置信度打分 0-100（≥80 才报为问题）。

Reviewer 2 — 正确性 & Bug:
  subagent_type: Explore
  prompt: |
    审查以下文件的代码变更（对比 main 分支）：
    变更文件：{文件列表}

    聚焦审查：
    1. 逻辑错误（条件判断、循环边界、空值处理）
    2. 错误处理缺失（try/catch、Promise rejection）
    3. 竞态条件或并发问题
    4. 边界情况（空数组、null/undefined）
    5. 安全问题（注入、XSS、敏感信息暴露）

    对每个问题给出：文件路径 + 行号 + 风险等级（高/中/低）+ 修复建议。
    如果代码正确，说"未发现正确性问题"。
    置信度打分 0-100（≥80 才报为问题）。

Reviewer 3 — 项目规范 & 一致性:
  subagent_type: Explore
  prompt: |
    审查以下文件的代码变更（对比 main 分支）：
    变更文件：{文件列表}

    聚焦审查：
    1. 是否遵循项目现有的命名规范
    2. 是否遵循项目的架构模式（数据流、模块边界）
    3. 新增的抽象是否合理
    4. 错误消息和日志是否有意义
    5. 是否与项目中类似功能的实现风格一致

    对每个问题给出：文件路径 + 行号 + 现有规范的参考位置 + 建议。
    如果代码符合规范，说"代码符合项目规范"。
    置信度打分 0-100（≥80 才报为问题）。
```

#### 汇总审查结果

等所有 reviewer 返回后：

1. **筛选高置信度问题**（≥80 分）
2. **按严重程度排序**：Bug > 安全 > DRY > 规范
3. **立即修复**：
   - Bug/安全问题 → 必须修复，改完重跑测试
   - DRY/规范问题 → 在当前 PR 范围内的修复，超范围的记录但不修
4. **修复后不需要重新审查** — 一轮审查足够

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
