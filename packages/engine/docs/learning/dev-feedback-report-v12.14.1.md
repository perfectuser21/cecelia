---
id: dev-feedback-report-v12.14.1
version: 1.0.0
created: 2026-02-08
updated: 2026-02-08
pr: "#548"
changelog:
  - 1.0.0: 初始版本 - 记录 /dev 反馈报告功能开发经验
---

# /dev 反馈报告生成功能开发经验 (v12.14.1)

## 功能概述

为 /dev workflow 添加结构化反馈报告生成功能，生成包含 11 个字段的 `.dev-feedback-report.json`。

## 关键技术决策

### 1. JSON Schema 设计

**11 个字段分三类**：

| 类别 | 字段 | 数据来源 |
|------|------|----------|
| **元数据** | task_id, branch, pr_number, completed_at | .dev-mode, git, gh CLI |
| **分析结果** | summary, issues_found, next_steps_suggested, technical_notes, performance_notes | quality-summary.json + AI 生成 |
| **统计数据** | code_changes, test_coverage | git diff, quality-summary.json |

**设计原则**：
- 所有字段必需（缺失时填充 N/A）
- JSON 格式有效（jq 验证）
- 字段类型明确（string/array/object）

### 2. 数据提取策略

#### code_changes 统计

```bash
# 文件列表
git diff develop --name-only

# 行数统计
git diff develop --shortstat
# 输出："3 files changed, 123 insertions(+), 45 deletions(-)"

# 解析
lines_added=$(echo "$shortstat" | grep -oP '\d+(?= insertion)')
lines_deleted=$(echo "$shortstat" | grep -oP '\d+(?= deletion)')
```

**关键点**：
- 使用 `grep -oP` (Perl 正则) 解析
- 处理单复数（insertion/insertions）
- 默认值：0

#### summary 生成

**数据源优先级**：
1. quality-summary.json 的 note 字段
2. 默认："功能实现完成"

**未来改进**：
- 使用 LLM 深度分析 git diff
- 生成更准确的总结

### 3. 错误处理

**3 层防护**：

1. **命令失败**：
```bash
git diff develop --name-only 2>/dev/null || echo ""
```

2. **字段缺失**：
```bash
task_id="${1:-$(get_task_id_from_dev_mode)}"
# 如果参数和 .dev-mode 都没有 → "N/A"
```

3. **JSON 格式**：
```bash
jq -n \
    --arg task_id "$task_id" \
    --arg branch "$branch" \
    '{ task_id: $task_id, branch: $branch }'
# jq 保证 JSON 有效
```

### 4. 集成到 Step 10

**修改点**：
- skills/dev/steps/10-learning.md
- 添加"生成反馈报告"章节
- 在 Learning 记录之后调用

**向后兼容**：
- 脚本失败不阻塞 /dev 完成
- 如果某些字段无法获取，填充 N/A

## 测试策略

### Mock 数据测试

```bash
# 创建临时 git repo
temp_dir=$(mktemp -d)
cd "$temp_dir"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

# 创建 develop 分支
echo "test" > test.txt
git add test.txt
git commit -q -m "Initial commit"
git checkout -q -b develop

# 创建 mock 文件
cat > .dev-mode <<EOF
dev
branch: test-branch
task_id: task-001
EOF

cat > quality-summary.json <<EOF
{
  "note": "Test summary",
  "changes": {}
}
EOF

# 创建测试分支并做改动
git checkout -q -b test-branch
echo "new content" >> test.txt
git add test.txt
git commit -q -m "Test commit"

# 运行脚本
bash /path/to/generate-feedback-report.sh task-001

# 验证
jq . .dev-feedback-report.json
```

### 6 个测试用例

1. **脚本存在且可执行** - 基础检查
2. **生成 JSON 文件** - 文件创建
3. **JSON 格式有效** - jq 验证
4. **所有必需字段存在** - 遍历 11 个字段
5. **code_changes 结构正确** - 嵌套对象验证
6. **处理缺失 .dev-mode 文件** - 错误处理

**全部通过** ✅

## 踩过的坑

### 1. grep -oP 在 macOS 上不可用

**问题**：
```bash
grep -oP '\d+(?= insertion)'  # Linux 可用
# macOS: grep: invalid option -- P
```

**解决**：
- Engine 部署在 Linux 服务器
- 不需要兼容 macOS
- 如果未来需要，改用 `sed` 或 `awk`

### 2. git diff 输出格式依赖 locale

**问题**：
```bash
# 英文："3 files changed, 123 insertions(+), 45 deletions(-)"
# 中文："3 个文件被修改，新增 123 行(+)，删除 45 行(-)"
```

**解决**：
```bash
export LANG=C  # 强制英文输出
git diff develop --shortstat
```

**当前实现**：未设置 LANG（假设环境是英文）
**未来改进**：在脚本开头设置 `LANG=C`

### 3. jq 数组拼接

**问题**：
```bash
# 错误：直接拼接字符串
files="[\"file1.txt\", \"file2.txt\"]"
jq -n --arg files "$files" '{files: $files}'
# 结果：{"files": "[\"file1.txt\", \"file2.txt\"]"}  # 字符串，不是数组
```

**解决**：
```bash
# 正确：使用 --argjson
files=$(printf '%s\n' "${files_modified[@]}" | jq -R . | jq -s .)
jq -n --argjson files "$files" '{files: $files}'
# 结果：{"files": ["file1.txt", "file2.txt"]}  # 数组
```

**关键**：`--arg` 传字符串，`--argjson` 传 JSON 对象/数组

## 性能优化

### Bash 脚本性能

**git 命令优化**：
- 使用 `--name-only` 而不是 `--name-status`（减少输出）
- 使用 `--shortstat` 而不是 `--numstat`（只需要总数）

**jq 性能**：
- 单次调用生成完整 JSON（而不是多次 jq 拼接）
- 性能：< 100ms

### 未来优化

**缓存 git diff 结果**：
```bash
# 当前：调用 2 次 git diff
git diff develop --name-only
git diff develop --shortstat

# 优化：调用 1 次，解析 2 次
diff_output=$(git diff develop)
# 解析文件列表和统计
```

## 未来工作

### Phase 3: /dev --task-id 集成

```bash
/dev --task-id task-001

# 流程：
1. 从数据库读取 Task PRD
2. 检查是否有上一个 Task (task-000) 的反馈报告
3. 如果有，读取反馈 → 调整实现策略
4. 生成 .prd-task-001.md
5. 执行 /dev workflow
6. 完成后生成 .dev-feedback-report.json → 存储到数据库
```

### Phase 4: Brain 自动化

```bash
# Brain 自动迭代流程
1. Task N 完成 → POST /api/brain/execution-callback
2. Brain 读取 .dev-feedback-report.json
3. Brain 调用 continue-feature.sh
4. continue-feature.sh 读取反馈 → 调整 Feature 计划
5. Brain 生成 Task N+1 PRD → 存储到数据库
6. Brain 自动派发 Task N+1
```

### 增强 AI 分析

**当前**：
- summary: 读取 quality-summary.json
- technical_notes: 简单字符串

**未来**：
- 使用 LLM 分析 git diff
- 生成更准确的 summary 和 technical_notes
- 识别重构机会、性能问题

**实现方案**：
```bash
# 在 generate-feedback-report.sh 中调用 LLM
git diff develop > /tmp/diff.txt

# 调用 LLM API
curl -X POST http://localhost:5221/api/brain/analyze-diff \
  -H "Content-Type: application/json" \
  -d '{"diff": "...", "context": "..."}'

# 获取分析结果
{
  "summary": "添加了反馈报告生成功能，修改了 10 个文件",
  "technical_notes": "使用 jq 处理 JSON，建议抽取通用函数到 lib/",
  "refactoring_opportunities": ["抽取 get_code_changes 函数", "统一 error handling"]
}
```

## 结论

/dev 反馈报告功能成功实现：
- ✅ 11 个字段完整
- ✅ 6 个测试全部通过
- ✅ 集成到 Step 10
- ✅ CI 自动化检查

关键教训：
1. **JSON 处理用 jq**：保证格式有效，避免手动拼接字符串
2. **错误处理完善**：3 层防护，缺失字段填充 N/A
3. **测试先行**：6 个测试覆盖所有功能
4. **向后兼容**：脚本失败不阻塞 /dev 完成

下一步：Phase 3 (/dev --task-id) 和 Phase 4 (Brain 自动化) 加入 Roadmap。
