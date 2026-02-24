---
name: credentials
description: |
  凭据管理 Skill。当涉及 API Token、Secret、Key 等敏感信息时自动触发。
  - 存储新凭据：保存到 ~/.credentials/ 目录
  - 查找凭据：从 ~/.credentials/ 目录读取
  全局适用，所有项目共享。
---

# 凭据管理 (Credentials Management)

当涉及 API Token、Secret、Key 等敏感信息时，遵循此规则。

---

## 存储位置

```
~/.credentials/           # 目录权限 700
├── cloudflare.env        # Cloudflare API
├── notion.env            # Notion API
├── feishu.env            # 飞书 API
├── github.env            # GitHub API
├── ...                   # 其他服务
└── README.md             # 说明文档
```

---

## 触发条件

当用户提到以下关键词时，自动应用此 skill：

- **存储场景**：用户给你 token、API key、secret、凭据、密钥
- **查找场景**：需要调用某个 API、找某个 token、访问某个服务

---

## 存储新凭据

当用户给你新的 API/Token 时：

### 1. 确定文件名
按服务名命名：`{service}.env`

| 服务 | 文件名 |
|------|--------|
| Cloudflare | cloudflare.env |
| Notion | notion.env |
| 飞书/Feishu | feishu.env |
| GitHub | github.env |
| OpenAI | openai.env |
| AWS | aws.env |

### 2. 存储格式
```bash
# {SERVICE}_API 凭据
# 更新于 {DATE}

{SERVICE}_API_TOKEN=xxx
{SERVICE}_API_KEY=xxx
{SERVICE}_SECRET=xxx
# ... 相关配置
```

### 3. 执行命令
```bash
# 创建或追加凭据
cat >> ~/.credentials/{service}.env << 'EOF'
# {SERVICE} API 凭据
# 更新于 $(date +%Y-%m-%d)

{KEY}={VALUE}
EOF

# 设置权限
chmod 600 ~/.credentials/{service}.env
```

### 4. 确认
```bash
echo "✅ 已保存到 ~/.credentials/{service}.env"
cat ~/.credentials/{service}.env | grep -v "^#" | head -3
```

---

## 查找凭据

当需要使用某个 API 时：

### 1. 列出所有凭据
```bash
ls ~/.credentials/*.env
```

### 2. 读取特定服务
```bash
cat ~/.credentials/{service}.env
```

### 3. 加载到环境变量
```bash
source ~/.credentials/{service}.env
echo $CLOUDFLARE_API_TOKEN  # 验证
```

---

## 已有凭据清单

| 文件 | 包含内容 |
|------|----------|
| `cloudflare.env` | CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_TUNNEL_ID, CLOUDFLARE_ZONE_ID |

---

## 安全规则

1. **权限**：目录 700，文件 600
2. **不入 git**：此目录不在任何项目中，不会被 git 追踪
3. **不外传**：凭据内容不要输出到日志或回复中（除非用户明确要求）
4. **定期检查**：
   ```bash
   ls -la ~/.credentials/
   ```

---

## 快速参考

```bash
# 查看所有凭据文件
ls ~/.credentials/

# 读取 Cloudflare 凭据
cat ~/.credentials/cloudflare.env

# 加载并使用
source ~/.credentials/cloudflare.env
curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" ...

# 添加新凭据
echo "NEW_TOKEN=xxx" >> ~/.credentials/newservice.env
chmod 600 ~/.credentials/newservice.env
```

---

**最后更新**: 2026-01-17
