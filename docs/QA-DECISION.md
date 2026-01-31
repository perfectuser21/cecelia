---
id: qa-decision-core-restructure
version: 1.0.0
created: 2026-01-31
updated: 2026-01-31
changelog:
  - 1.0.0: 初始版本
---

# QA Decision - Core Features Restructure

## Decision Summary

```yaml
Decision: NO_RCI
Priority: P1
RepoType: Business
```

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| 目录结构正确 | manual | 检查 apps/core/features/ |
| FeatureManifest 正确 | manual | 检查 5 个 index.ts |
| build 通过 | auto | npm run build |

## Reason

纯文件移动和 import 重构，不改业务逻辑。build 通过即证明 import 正确。
