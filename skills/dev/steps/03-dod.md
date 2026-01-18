# Step 3: DoD

> 定义验收标准（Definition of Done）+ 测试层级确认

**完成后设置状态**（这步完成后才能写代码）：
```bash
git config branch."$BRANCH_NAME".step 3
```

---

## 3.1 自动扫描层级

根据需求描述**自动推断**需要的质检层级。

```bash
# 根据 PRD 描述自动扫描
bash "$ZENITHJOY_ENGINE/skills/dev/scripts/scan-change-level.sh" --desc "用户需求描述"
```

**输出示例**：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  需求分析结果
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  建议层级: L4
  原因: 需求涉及用户界面

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 自动推断规则

| 关键词 | 层级 | 说明 |
|--------|------|------|
| 安全/认证/密码/token | L6 | 安全审计 |
| 性能/优化/缓存 | L5 | 性能测试 |
| 页面/组件/UI/前端 | L4 | E2E 测试 |
| API/接口/数据库 | L3 | 集成测试 |
| 函数/工具/逻辑 | L2 | 单元测试 |
| 文档/配置 | L1 | 静态分析 |

### 检查是否超出项目能力

```bash
# 获取项目能力上限（从 .project-info.json）
PROJECT_MAX=$(jq -r '.test_levels.max_level // 0' .project-info.json 2>/dev/null || echo "0")

# 扫描得到的建议层级
TASK_MIN=<扫描结果>

echo "项目能力上限: L$PROJECT_MAX"
echo "任务需要层级: L$TASK_MIN"

if [[ $TASK_MIN -gt $PROJECT_MAX ]]; then
    echo ""
    echo "⚠️  任务需要 L$TASK_MIN，但项目只支持到 L$PROJECT_MAX"
    echo "   需要先升级项目测试能力"
fi
```

### 如果需要升级

当任务需要的层级 > 项目能力时，**先升级项目能力**：

| 要升级到 | 需要添加 |
|----------|----------|
| L3 | API 测试框架 + test:integration 脚本 |
| L4 | playwright/cypress + e2e/ 目录 |
| L5 | benchmark 脚本 + benchmark/ 目录 |
| L6 | npm audit 或 snyk 配置 |

升级任务作为**前置任务**先完成。

---

## 3.2 DoD 模板

```markdown
## DoD - 验收标准

### 测试层级
- 项目能力: L<X>
- 任务需要: L<Y>
- 实际执行: L1 ~ L<max(X,Y)>

### 自动测试
- [ ] TEST: <测试命令/断言 1>
- [ ] TEST: <测试命令/断言 2>

### 人工确认
- [ ] CHECK: <需要用户确认的点>
```

---

## 3.3 示例

```markdown
## DoD - 用户登录功能

### 测试层级
- 项目能力: L4
- 任务需要: L4 (涉及用户界面)
- 实际执行: L1 + L2 + L3 + L4

### 自动测试
- [ ] TEST: L2 - 登录函数单元测试
- [ ] TEST: L3 - 登录 API 集成测试
- [ ] TEST: L4 - 登录流程 E2E 测试

### 人工确认
- [ ] CHECK: 登录页面样式符合设计
```

---

## 3.4 PRD + DoD 确认后

**用户确认后，设置步骤状态**：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
git config branch."$BRANCH_NAME".step 3
echo "✅ Step 3 完成 (DoD 确认)，可以开始写代码"
```

**Hook 检查**：step >= 3 才能写代码。
