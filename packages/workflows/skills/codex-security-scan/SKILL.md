---
name: codex-security-scan
version: 1.0.0
created: 2026-03-21
description: |
  Codex 自动安全扫描。扫描代码库中的 OWASP Top 10 安全问题，输出结构化安全报告。
  运行在西安 Mac mini M4（Codex），不需要 Claude Code。
  由 Brain 自动派发，推动免疫系统 KR。
---

# codex-security-scan — Codex 自动安全扫描

**执行位置**: 西安 Mac mini M4（Codex）
**task_type**: `codex_security_scan`
**角色归属**: CTO（coding domain）

## 触发方式

Brain 自动派发（定时或由免疫系统触发）：

```json
{
  "task_type": "codex_security_scan",
  "title": "安全扫描: packages/brain/src/",
  "payload": {
    "target_path": "packages/brain/src/",
    "scan_scope": "full",
    "reason": "定时安全巡检"
  }
}
```

## OWASP Top 10 扫描范围

| 编号 | 类别 | 检查项 |
|------|------|--------|
| A01 | 访问控制失效 | 缺少鉴权中间件、权限绕过 |
| A02 | 加密失效 | 明文密码、弱加密算法、硬编码密钥 |
| A03 | 注入 | SQL 注入、命令注入、LDAP 注入 |
| A04 | 不安全设计 | 缺少速率限制、敏感数据暴露 |
| A05 | 安全配置错误 | 调试模式开启、默认凭据、宽松 CORS |
| A06 | 易受攻击组件 | 已知漏洞依赖（npm audit） |
| A07 | 身份验证失效 | 弱 session 管理、不安全令牌 |
| A08 | 软件完整性失效 | 不可信数据反序列化 |
| A09 | 安全日志不足 | 敏感操作无审计日志 |
| A10 | SSRF | 未验证外部 URL 请求 |

## 执行流程

### Step 1: 确定扫描目标

如果 payload 指定了 `target_path`，直接使用。否则默认扫描全仓库：

```bash
# 优先级：
# 1. payload.target_path 指定路径
# 2. 近 48h 有 git 提交的文件
# 3. 全量扫描 packages/
TARGET=${TARGET_PATH:-"packages/"}
```

### Step 2: 静态分析

```bash
# 检查硬编码凭据
grep -rn "password\s*=\s*['\"][^'\"]\|api_key\s*=\s*['\"][^'\"]" "$TARGET" \
  --include="*.js" --include="*.ts" | grep -v ".env\|test\|spec"

# 检查 SQL 注入风险（字符串拼接 SQL）
grep -rn "query.*\+\|query.*\`" "$TARGET" --include="*.js" | grep -v "// safe\|parameterized"

# 检查命令注入（exec/spawn + 用户输入）
grep -rn "exec\|execSync\|spawn" "$TARGET" --include="*.js" | grep -v "test\|spec"

# 检查不安全 eval
grep -rn "\beval\s*(\|new Function\s*(" "$TARGET" --include="*.js"
```

### Step 3: 依赖漏洞扫描

```bash
# 扫描已知漏洞依赖
npm audit --audit-level=high 2>&1 | head -50
```

### Step 4: 输出安全报告

在 `docs/security-reports/` 创建报告文件：

```
docs/security-reports/YYYY-MM-DD-security-scan.md
```

报告格式：

```markdown
# 安全扫描报告 — YYYY-MM-DD

## 执行摘要
- 扫描范围: xxx
- 发现问题: N 个（Critical: X, High: Y, Medium: Z）

## Critical 问题

### [C1] 标题
- 文件: path/to/file.js:行号
- 类型: OWASP A03 - 注入
- 描述: 具体问题描述
- 修复建议: 如何修复

## High 问题
...

## 依赖漏洞
...

## 结论
```

### Step 5: 提交报告

```bash
git add docs/security-reports/
git commit -m "security: 安全扫描报告 — $(date +%Y-%m-%d)"
```

如发现 Critical 或 High 问题，额外创建 Brain 任务：

```bash
curl -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "dev",
    "title": "修复安全漏洞: [问题标题]",
    "priority": "P0",
    "description": "发现 OWASP [类别] 漏洞，需立即修复：[描述]"
  }'
```

## 输出产物

| 产物 | 位置 | 说明 |
|------|------|------|
| 安全报告 | `docs/security-reports/YYYY-MM-DD-security-scan.md` | 结构化报告 |
| Brain 任务 | 自动创建 | Critical/High 问题触发修复任务 |
