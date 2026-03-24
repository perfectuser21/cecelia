# Learning: fix(ci): Deploy soft-fail + L4 DoD gate PR-only

**分支**: cp-03242032-fix-ci-deploy-dod-gate  
**日期**: 2026-03-24  

## 问题描述

1. `deploy.yml` 每次 push to main 因 HTTP 405（服务端不支持 POST）失败，导致整条 CI 链标红，干扰开发信噪比。
2. `ci-l4-runtime.yml` 的 `devgate-checks` job 直接 push to main 时因 `GITHUB_HEAD_REF` 为空而硬失败，但该检查本应只在 PR 时运行。

### 根本原因

- Deploy webhook 端（`dev-autopilot.zenjoymedia.media`）尚未就绪，但 CI 没有容错机制，任何 HTTP 非 2xx 都直接 exit 1。
- DoD Verification Gate 依赖 `GITHUB_HEAD_REF`（只有 PR 事件才有值），但没有加 `if: github.event_name == 'pull_request'` 防护。
- 修复 devgate-checks 条件后，必须同步修复 `l4-passed` gate 的判断逻辑：当 devgate-checks 被跳过（result=`skipped`）时，gate 不能当作失败处理。

### 下次预防

- [ ] 任何依赖外部服务的 CI job，首次引入时就加 `continue-on-error: true` 或有明确回退策略
- [ ] 依赖 `GITHUB_HEAD_REF`/`GITHUB_HEAD_SHA` 等 PR 专有变量的 job，必须加 `if: github.event_name == 'pull_request'`
- [ ] 修改某 job 的 `if` 条件时，同步检查下游 gate job 是否正确处理 `skipped` 状态
