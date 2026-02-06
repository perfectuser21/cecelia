---
id: optimal-paths
version: 2.71.0
created: 2026-02-06
updated: 2026-02-06
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - 2.71.0: 从 feature-registry.yml 自动生成
---

# Optimal Paths - 推荐体验路径

**来源**: `features/feature-registry.yml` (单一事实源)
**用途**: 每个 feature 的"推荐体验路径"（优化后的流程）
**生成**: 自动生成，不要手动编辑

---

## Platform Core 5 - 平台基础设施

### H1: Branch Protection

```
检测当前分支 → main/develop → exit 2 (阻止) | cp-*/feature/* → exit 0 (放行)
```

---

### H7: Stop Hook Loop Controller (JSON API)

```
会话结束 → 检测 .dev-mode → 检查完成条件 → exit 2 (继续) | exit 0 (结束)
```

---

### H2: PR Gate (Dual Mode)

```
检测命令 (gh pr create) → 判断模式 (PR/Release) → 检查产物 → 通过/阻止
```

---

### W1: Unified Dev Workflow

```
完整的 Golden Path（11 步）：
1. PRD 确定
2. 环境检测
3. 分支创建 (cp-MMDDTTTT-xxx)
4. DoD 定稿 (含 QA Decision Node)
5. 写代码
6. 写测试
7. 质检循环 (Audit + L1, Stop Hook 强制)
8. 提交 PR (p0 结束)
9. CI 修复 (p1 事件驱动)
10. Learning
11. Cleanup
```

---

### Q1: Impact Check

```
PR 改动核心文件 → impact-check.sh 检测 → 验证 registry 同时更新 → 通过/失败
```

---

### Q2: Evidence Gate

```
npm run qa:gate → 生成 .quality-evidence.json → CI 验证 SHA/字段 → 通过/失败
```

---

### Q3: Anti-Bypass Contract

```
开发者理解质量契约 → 本地 Hook 提前反馈 → 远端 CI 最终强制 → Branch Protection 物理阻止
```

---

### Q4: CI Layering (L2B + L3-fast + Preflight + AI Review)

```
本地 → ci:preflight (快速预检) → L2B 证据创建 → PR Gate (L2B-min) →
CI → l2b-check job → ai-review job → 通过/失败
```

---

### Q5: RISK SCORE Trigger

```
/dev Step 3 → risk-score.cjs (计算分数) → ≥3 分 → 执行完整 QA Decision Node →
生成 docs/QA-DECISION.md
```

---

### Q6: Structured Audit

```
/dev Step 6 → compare-scope.cjs (验证范围) → check-forbidden.cjs (检查禁区) →
check-proof.cjs (验证证据) → generate-report.cjs (生成报告) →
AUDIT-REPORT.md (Decision: PASS/FAIL)
```

---

## Product Core 5 - 引擎核心能力

### P1: Regression Testing Framework

```
定义 RCI (regression-contract.yaml) → rc-filter.sh 过滤 →
run-regression.sh 执行 → 验证契约不被破坏
```

---

### P2: DevGate

```
CI test job → DevGate checks → 三个检查全部通过 → CI 继续
```

---

### P3: Quality Reporting

```
执行脚本 → 扫描 repo 结构 → 生成 JSON/TXT 报告 → 供 Dashboard 使用
```

---

### P4: CI Quality Gates

```
PR 创建 → CI 触发 → version-check + test + DevGate → 全部通过 → ci-passed
```

---

### P5: Worktree Parallel Development

```
/dev 启动 → Step 0 检测 .dev-mode → 僵尸则清理 → 活跃则自动创建 worktree + cd → 继续正常流程
```

---

### P6: Self-Evolution Automation

```
问题发现 → 记录到 docs/SELF-EVOLUTION.md → 创建检查项 → 自动化脚本 → 集成到流程
```

---

### H8: Credential Guard

```
写入代码 → credential-guard.sh 检测 → 真实凭据 → exit 2 (阻止) | 占位符/credentials目录 → exit 0 (放行)
```

---

### H9: Bash Guard (Credential Leak + HK Deploy Protection)

```
Bash 命令 → token 扫描 (~1ms) → rsync/scp + HK 检测 (~1ms) →
未命中 → 放行 | 命中 HK → git 三连检 → 通过/阻止
```

---

## 更新规则

**本文件自动生成，不要手动编辑**。

所有变更必须：
1. 先更新 `features/feature-registry.yml`
2. 运行: `bash scripts/generate-path-views.sh`
3. 提交生成的视图文件

---

**来源**: features/feature-registry.yml
**版本**: 2.71.0
**生成时间**: 2026-02-06
