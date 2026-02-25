# AI Review Prompt (L2C - 语义审查)

## 背景

VPS 代码审查 API (`/webhook/code-review`) 需要更新提示词，专注于 L2C 层（语义/影响面审查），而不是重复 CI 已覆盖的 L1/L2A/L2B/L3。

## 提示词（L2C 专用版）

```
你是 PR 语义审查员（L2C）。CI 已覆盖 typecheck/test/build/l2a/evidence/impact/devgate。
你的任务不是重复 CI，而是指出"语义逻辑风险、影响面遗漏、跨文件契约不一致、未来维护风险"。

输入：PR diff（可能截断）。
输出格式（纯文本，不用 markdown）：

## 语义风险（高）
[若无写"无"]
[每条必须包含：风险点 → 可能后果 → 建议修复/补证据]

## 影响面遗漏（中）
[列出可能遗漏修改的文件/测试/文档/registry/契约点]
[若无写"无"]
[尽量具体到路径/模块]

## 设计与一致性建议（低）
[命名/结构/一致性]
[若无写"无"]
[不阻断]

## 建议的补充证据（L2B）
[建议在 .layer2-evidence.md 加什么可复核证据：命令、截图、curl 结果、回归点]

## 总体结论
[OK 或 NEEDS_ATTENTION]
```

## 核心变化

### 之前（通用审查）
- 纠缠 lint/test/format（与 CI 重复）
- 缺少影响面分析
- 没有证据建议

### 之后（L2C 专用）
- ✅ 专注语义逻辑风险
- ✅ 影响面遗漏检查（跨文件一致性）
- ✅ 建议补充证据（L2B）
- ✅ 不重复 CI 检查

## 部署

更新 VPS `/webhook/code-review` 端点的系统提示词为上述内容。

## 示例输出

```
## 语义风险（高）
1. hooks/pr-gate-v2.sh Line 250 新增 preflight 调用，但未处理 timeout 失败场景
   → 可能后果：preflight 超时时仍放行 PR
   → 建议：增加 timeout 后的 FAILED=1

## 影响面遗漏（中）
1. 修改了 CI 流程，但未更新 docs/ARCHITECTURE.md
2. 新增 l2b-check job，但 README 未提及 L2B 概念
3. package.json 新增 scripts，考虑在 CONTRIBUTING.md 说明使用方法

## 设计与一致性建议（低）
1. ci-preflight.sh 输出格式与其他 gate 脚本不一致（建议统一边框样式）
2. l2b-check.sh 变量命名风格混合（EVIDENCE_FILE vs MODE）

## 建议的补充证据（L2B）
1. 在 .layer2-evidence.md 添加：运行 ci:preflight 的完整输出
2. 截图：GitHub Actions UI 显示新增的 l2b-check job
3. 手动测试：无 .layer2-evidence.md 时 l2b-check 正确失败

## 总体结论
NEEDS_ATTENTION（影响面遗漏文档更新）
```

## 集成点

GitHub Actions workflow (`.github/workflows/ci.yml`):
```yaml
ai-review:
  needs: [ci-passed]
  steps:
    - name: Call AI Review API
      run: |
        curl -X POST "$VPS_REVIEW_URL" \
          -H "Content-Type: application/json" \
          -d "{\"diff\": \"$(cat pr.diff)\"}"
```

## 不阻断 PR

初期使用 `continue-on-error: true`，AI Review 失败不影响 PR 合并。
后续稳定后可升级为 required check。
