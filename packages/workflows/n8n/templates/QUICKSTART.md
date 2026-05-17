# N8N Claude 模板快速开始

## 5 分钟上手

### 1️⃣ 最简单：问答型

**场景**：调用 Claude 回答问题或执行简单任务

```bash
# 测试模板
curl -X POST http://localhost:5679/webhook/simple-claude \
  -H "Content-Type: application/json" \
  -d '{"prompt": "列出 /home/xx/dev 目录下所有项目"}'
```

**返回**：
```json
{
  "success": true,
  "task_id": "task-1737849600000",
  "result": { /* Claude 的回复 */ }
}
```

---

### 2️⃣ 文件处理型

**场景**：读取文件 → Claude 分析 → 输出结果

```bash
curl -X POST http://localhost:5679/webhook/claude-file-process \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "/home/xx/dev/myproject/package.json",
    "task": "分析依赖并找出过时的包",
    "output_path": "/tmp/package-analysis.json"
  }'
```

---

### 3️⃣ 完整开发流程

**场景**：自动执行完整开发工作流（分支 → 代码 → PR）

```bash
curl -X POST http://localhost:5679/webhook/claude-dev \
  -H "Content-Type: application/json" \
  -d '{
    "project": "myproject",
    "repo_path": "/home/xx/dev/myproject",
    "prd": "添加用户登录功能\n- JWT token\n- bcrypt 加密"
  }'
```

**自动执行**：
1. 创建分支 `cp-MMDDTTTT-feature`
2. 生成 DoD
3. 写代码 + 测试
4. 质检
5. 创建 PR
6. CI 检查

---

### 4️⃣ 定时任务

**场景**：每天自动执行 Claude 任务

**修改步骤**：
1. 打开 N8N 界面：https://n8n.zenjoymedia.media
2. 导入 `04-scheduled-claude-task.json`
3. 修改 `Prepare Task` 节点的 prompt
4. 修改 Cron 表达式（默认每天 2:00 AM）
5. 激活 workflow

**Cron 示例**：
```
0 2 * * *     - 每天 2:00 AM
0 */6 * * *   - 每 6 小时
0 9 * * 1     - 每周一 9:00 AM
```

---

### 5️⃣ 批量处理

**场景**：并发执行多个 Claude 任务（自动限流）

```bash
curl -X POST http://localhost:5679/webhook/claude-batch \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {"prompt": "分析文件 A"},
      {"prompt": "分析文件 B"},
      {"prompt": "分析文件 C"}
    ]
  }'
```

**返回**：
```json
{
  "batch_id": "batch-1737849600000",
  "total_tasks": 3,
  "successful": 3,
  "results": [ /* 所有任务结果 */ ]
}
```

---

## 导入模板

### 方式 1: N8N 界面

```
1. 打开 https://n8n.zenjoymedia.media
2. 点击右上角 "Import Workflow"
3. 选择模板文件（.json）
4. 修改 webhook 路径（避免冲突）
5. 修改业务逻辑节点
6. 激活 workflow
```

### 方式 2: 命令行（TODO）

```bash
# 从模板创建新 workflow
bash ~/.claude/skills/n8n-manage/scripts/create-from-template.sh \
  01-simple-claude-call.json \
  "my-new-workflow" \
  "my-webhook"
```

---

## 定制化

### 修改 Prompt

找到 `Code` 类型的节点（通常叫 "Prepare Prompt" 或 "Build Prompt"），修改：

```javascript
// 原来：
const prompt = "默认任务";

// 改成你的业务逻辑：
const prompt = `
分析用户输入: ${$json.body.user_input}
检查语法错误
返回 JSON 格式报告
`;
```

### 添加认证

在 Webhook 节点添加认证：

```javascript
// 在 "Prepare" 节点之前添加验证节点
const token = $json.headers?.authorization;
if (token !== 'Bearer YOUR_SECRET_TOKEN') {
  throw new Error('Unauthorized');
}
```

### 添加通知

在结果处理后添加 HTTP Request 节点：

```
Respond → HTTP Request (Slack/Discord/Email)
```

---

## 常见问题

### Q: Webhook 返回 404？
```bash
# 检查 workflow 是否激活
bash ~/.claude/skills/n8n-manage/scripts/list-workflows.sh

# 重启 N8N
docker restart n8n-self-hosted
```

### Q: Claude 超时？
修改 SSH 节点的 timeout 选项（默认 2 分钟）：
```json
{
  "options": {
    "timeout": 600000  // 10 分钟
  }
}
```

### Q: 如何查看日志？
```bash
# Claude 执行日志
tail -f ~/logs/cecelia-run.log

# N8N 容器日志
docker logs -f n8n-self-hosted
```

---

## 下一步

1. **备份**：定期运行
   ```bash
   bash ~/.claude/skills/n8n-manage/scripts/backup-from-n8n.sh
   ```

2. **版本控制**：修改后提交到 Git
   ```bash
   cd /home/xx/dev/cecelia-workflows
   git add n8n/
   git commit -m "更新 workflow"
   git push
   ```

3. **监控**：配置 Webhook 回调，记录执行状态

4. **扩展**：组合多个模板，创建复杂工作流
