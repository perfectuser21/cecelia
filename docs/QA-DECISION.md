# QA Decision: 测试清理和 CI 漏洞修复（第二批）

Decision: NO_RCI
Priority: P1
RepoType: Engine

## 变更范围

| 文件 | 类型 | 影响 |
|------|------|------|
| tests/hooks/detect-priority.test.ts | 测试 | 删除 17 个无效 skip 测试 |
| tests/hooks/pr-gate-phase1.test.ts | 测试 | 删除 3 个无效 skip 测试 |
| tests/hooks/metrics.test.ts | 测试 | 保留 1 个 skip（已注释原因） |

## Skip 测试分析

| 文件 | Skip 数量 | 原因 | 处理方案 |
|------|-----------|------|----------|
| detect-priority.test.ts | 17 | PR_TITLE 检测功能已移除 | 删除测试 |
| pr-gate-phase1.test.ts | 3 | QA-DECISION 优先/PR_TITLE 移除 | 删除测试 |
| metrics.test.ts | 1 | 临时目录不稳定 | 保留 skip，已有 TODO 注释 |

## known-failures 漏洞状态

**已确认修复**：ci.yml L149-198 显示严格校验逻辑已存在：
- 如果文件缺失 → else 分支 → "测试失败且无有效的 known-failures 配置" → exit
- 攻击者无法通过删除文件绕过校验
- 无需额外修改

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| 清理 skip 的测试 | auto | npm run test |
| known-failures 漏洞已修复 | auto | .github/workflows/ci.yml（已存在） |
| 测试通过数量保持 | auto | npm run test |
| CI 测试通过 | auto | .github/workflows/ci.yml |

RCI:
  new: []
  update: []

Reason: 测试代码清理任务，删除因 PR_TITLE 功能移除而失效的 skip 测试。不涉及新功能，无需新增 RCI。
