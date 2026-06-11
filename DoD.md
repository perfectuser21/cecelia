contract_branch: cp-06120136-ws-d8acba51-ws1
sprint_dir: sprints/06112201-ci-defense

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: CI 防线：--changed 漏检修复 + skill 契约测试 + 合同存在性 gate

**范围**: packages/brain/scripts/ci/ 新增两个 CLI 脚本、packages/brain/src/__tests__/skill-contract.test.js 新增、.github/workflows/skill-ci.yml 新建（独立 skill CI workflow）
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/scripts/ci/changed-test-router.mjs` 文件存在且可执行
- [x] [ARTIFACT] `packages/brain/scripts/ci/contract-existence-check.mjs` 文件存在
- [x] [ARTIFACT] `packages/brain/src/__tests__/skill-contract.test.js` 文件存在且含 `env_missing` 断言
- [x] [ARTIFACT] `.github/workflows/skill-ci.yml` 存在且含 YAML 列表项格式的 `packages/workflows/skills/**` path 触发（非注释行）
- [x] [ARTIFACT] `.github/workflows/skill-ci.yml` 含 2 空格缩进的顶层 `skill-ci:` job key 行

## BEHAVIOR 条目

- [x] [BEHAVIOR] `changed-test-router.mjs --files <skill_file>` → stdout 含 skill-contract 测试路径（非空）
- [x] [BEHAVIOR] `changed-test-router.mjs` 无 --files 参数 → fail-closed（exit 非 0）
- [x] [BEHAVIOR] `skill-contract.test.js` vitest 正向全绿 + 7 项不变量内容覆盖
- [x] [BEHAVIOR] `skill-contract.test.js` 反向 fixture 含显式 `toBe(false)` 断言（非隐式 truthy）
- [x] [BEHAVIOR] `skill-contract.test.js` env_missing 反向 fixture it() 执行通过（检测逻辑对篡改输入返回 ok=false）
- [x] [BEHAVIOR] `contract-existence-check.mjs` sprint 目录缺合同 → exit 非 0
- [x] [BEHAVIOR] `contract-existence-check.mjs` sprint 目录含合同 → exit 0
