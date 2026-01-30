# QA Decision: CI 硬化

Decision: PASS
Priority: P0
RepoType: Engine

## 变更范围

| 文件 | 类型 | 影响 |
|------|------|------|
| ci/scripts/generate-evidence.sh | Shell | Evidence 生成逻辑 |
| ci/scripts/evidence-gate.sh | Shell | Evidence 验证逻辑 |
| scripts/devgate/check-dod-mapping.cjs | Node | DoD→Test 映射检查 |
| scripts/devgate/l2a-check.sh | Shell | L2A 内容验证 |
| scripts/devgate/l2b-check.sh | Shell | L2B 内容验证 |
| scripts/devgate/scan-rci-coverage.cjs | Node | RCI 覆盖率匹配 |
| .github/workflows/ci.yml | YAML | CI check 输出 |

## 测试决策

### 测试级别: L1 (Unit) + L2A (Integration)

**理由**:
- P0 安全修复：Evidence 硬编码和 manual: 后门是严重漏洞
- 必须有自动化测试验证拦截逻辑
- 每个修复点都需要反例测试

Tests:
  - dod_item: "Evidence 从真实 checks 汇总"
    method: auto
    location: tests/ci/evidence.test.ts

  - dod_item: "evidence-gate 验证事实"
    method: auto
    location: tests/ci/evidence.test.ts

  - dod_item: "manual: 必须有 manual_verifications"
    method: auto
    location: tests/gate/scan-rci-coverage.test.ts

  - dod_item: "L2A 检查结构+密度"
    method: auto
    location: tests/devgate/l2a-check.test.ts

  - dod_item: "RCI coverage 精确匹配"
    method: auto
    location: tests/gate/scan-rci-coverage.test.ts

RCI:
  new: []
  update: [C8-001]

Reason: P0 安全修复，必须在 CI 层面强制验证真实结果，堵死硬编码和 bypass 漏洞。
