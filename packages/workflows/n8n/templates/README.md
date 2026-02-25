# N8N Workflow 模板库

**快速创建包含无头 Claude Code 调用的 N8N workflows**

## 模板列表

| 模板 | 用途 | 触发方式 |
|------|------|---------|
| `01-simple-claude-call.json` | 最简单的 Claude 调用 | Webhook |
| `02-claude-file-processor.json` | 文件处理（读取→分析→输出） | Webhook |
| `03-claude-dev-flow.json` | 完整开发流程（/dev） | Webhook |
| `04-scheduled-claude-task.json` | 定时任务 | Cron |
| `05-claude-batch-processor.json` | 批量处理 | Webhook |

## 使用方法

### 方式 1: N8N 界面导入

```bash
1. 打开 https://n8n.zenjoymedia.media
2. 点击 Import Workflow
3. 选择模板文件
4. 修改业务逻辑节点
5. 激活 workflow
```

### 方式 2: 命令行快速创建

```bash
# 从模板创建新 workflow
bash ~/.claude/skills/n8n-manage/scripts/create-from-template.sh \
  templates/01-simple-claude-call.json \
  "my-new-workflow" \
  "my-webhook-path"
```

## 模板结构

所有模板包含以下核心节点：

```
触发器 → 参数准备 → SSH 调用 Claude → 结果处理 → 响应/通知
         ↓ 如果失败
         错误处理 → 通知
```

## 核心命令

所有模板都使用这个基础命令：

```bash
# 基础调用
claude -p "你的任务描述" --output-format json

# 从文件读取 Prompt
claude -p "$(cat /path/to/prompt.txt)" --output-format json

# 触发开发流程
claude -p "/dev $(cat .prd.md)" --output-format json

# 使用 cecelia-run（带并发控制）
cecelia-run task-id checkpoint-id /path/to/prompt.txt
```

## 定制方法

### 修改 Prompt

找到 `Code` 节点，修改这部分：

```javascript
// 原来：
const prompt = "默认任务描述";

// 改成你的业务逻辑：
const prompt = `
分析用户输入: ${$json.body.input}
输出 JSON 格式报告
`;
```

### 添加文件处理

```javascript
// 1. 准备 Prompt 文件
const fs = require('fs');
const promptPath = '/tmp/task-' + Date.now() + '.txt';
fs.writeFileSync(promptPath, yourPromptContent);

// 2. 调用 Claude
const result = $exec(`claude -p "$(cat ${promptPath})" --output-format json`);

// 3. 清理
fs.unlinkSync(promptPath);
```

### 添加并发控制

使用 `cecelia-run` 替代直接调用：

```bash
# 原来：
claude -p "..." --output-format json

# 改为：
echo "你的 prompt" > /tmp/prompt.txt
cecelia-run task-123 cp-001 /tmp/prompt.txt
```

## 环境变量

模板中可用的环境变量：

```bash
# Claude Code
CLAUDE_API_KEY        # API Key（如需要）
CLAUDE_MODEL          # 模型选择（默认 sonnet）

# Cecelia
MAX_CONCURRENT=3      # 最大并发数
WEBHOOK_URL           # 完成后回调 URL
CECELIA_WEBHOOK_TOKEN # Webhook 认证 token
```

## 示例场景

### 场景 1: 自动代码审查

```
Git Push → Webhook → Claude 分析代码 → 发送报告到 Slack
```

使用模板：`01-simple-claude-call.json`

### 场景 2: 批量文档生成

```
Cron 每天 → 读取待处理文件 → Claude 生成文档 → 保存到 Git
```

使用模板：`04-scheduled-claude-task.json`

### 场景 3: 自动修复 Bug

```
Notion 新建 Bug → Webhook → /dev 流程 → PR 自动合并
```

使用模板：`03-claude-dev-flow.json`

## 调试技巧

### 查看 Claude 输出

```bash
# 查看最近的执行日志
tail -f /tmp/cecelia-*.log

# 查看 cecelia-run 日志
tail -f ~/logs/cecelia-run.log
```

### 测试 Webhook

```bash
# 测试模板 workflow
curl -X POST http://localhost:5679/webhook/your-path \
  -H "Content-Type: application/json" \
  -d '{"input": "test data"}'
```

## 相关文档

- [N8N 主文档](/home/xx/dev/cecelia-workflows/n8n/README.md)
- [Cecelia 完整文档](/home/xx/dev/Cecelia-OS/README.md)
- [如何触发 Cecelia](/home/xx/dev/Cecelia-OS/docs/HOW_TO_TRIGGER_CECELIA.md)
