---
id: learning-cp-03161850-fix-coverage-delta-vitest
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: 修复 coverage-delta，换用 vitest-coverage-report-action

## 任务概要

替换 `ci-l3-code.yml` 中的 `coverage-delta` job，从不兼容的 `anuraag016/Jest-Coverage-Diff` 换成专为 vitest 设计的 `davelosert/vitest-coverage-report-action@v2`，同时添加 `coverage-baseline` job 用于 push main 时更新基线。

## 根本原因

`anuraag016/Jest-Coverage-Diff` 内部跑 `npx jest`，与 Brain 的 vitest 测试框架完全不兼容。PR #991 验证时发现该 action 的 `@main` 分支也不存在，导致 action 无法解析。

`davelosert/vitest-coverage-report-action@v2` 专为 vitest 的 `json-summary` 输出格式设计，直接读取 `coverage/coverage-summary.json`，在 PR 评论中展示覆盖率变化。

## 技术要点

### vitest-coverage-report-action 使用方式

```yaml
- name: Coverage Report
  uses: davelosert/vitest-coverage-report-action@v2
  with:
    json-summary-path: packages/brain/coverage/coverage-summary.json
    json-summary-compare-path: packages/brain/coverage/coverage-summary-base.json
    comment-on: pr
```

### coverage-baseline job（push 到 main）

PR 对比需要基线。通过在 push main 时跑 coverage 并上传 artifact，PR 时下载基线 artifact 对比：

```yaml
coverage-baseline:
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  steps:
    - run: npm run test:coverage
    - uses: actions/upload-artifact@v4
      with:
        name: coverage-baseline
        path: packages/brain/coverage/coverage-summary.json
```

### 第三方 action 引用规范

- 必须用 pinned tag（如 `@v2`），不得用 `@main`/`@master`
- 建议使用 commit SHA pinning 提升安全性
- 关键路径上加 `continue-on-error: true` 作为保护（首次运行无基线时不阻塞）

## 下次预防

- [x] 引用第三方 GitHub Action 时，先确认目标分支/tag 存在
- [ ] 新 CI job 涉及第三方 action，应在同一 PR 做端到端验证
- [ ] coverage artifact 基线缺失时（首次 PR），job 应 skip 而非 fail
