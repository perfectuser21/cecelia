# Contract DoD：CI 两处失明修复

sprint_dir: sprints/07290954-ci-blindspot-fix
task_id: 241578ce-6726-4658-afbc-03ac93036494
created: 2026-07-29

---

## Invariant 验收标准

| # | 验收项 | 技术断言 | 判定方式 |
|---|--------|---------|---------|
| I1 | TDD commit 顺序正确 | `lint-tdd-commit-order` 检测到 Commit-1（红：PASS=0 FAIL=3）在先、Commit-2（绿：PASS=3 FAIL=0）在后 | CI job lint-tdd-commit-order result == success |
| I2 | 本 PR 触发全量测试 | 因改了 `.github/workflows/**`，changes job 所有 6 个 output 均为 true，无 job 因 if 判断被 skip | CI run 日志 detect step 输出全 true |
| I3 | fleet-worker 5 个测试在 CI 中真实执行 | `brain-tests-shell` job status == success（非 skipped），5 个 .test.sh 均有 ::group:: 日志 | gh run view + job log 验证 |
| I4 | brain-tests-shell 是 ci-passed 必过项 | ci-passed needs 数组含 brain-tests-shell，check 函数对其 result 做 skipped=fail 判断（现有 check 函数语义已覆盖） | grep ci.yml |
| I5 | 全 CI 绿，无既有 job 破坏 | ci-passed 最终 exit 0 | CI status == success |
| I6 | 合入 main 后下次 push CI 不 skip | push 到 main 触发的 run 中 brain-unit / engine-tests-shell 等 job status == success 或 failure（非 skipped） | gh run list --branch main --limit 1 |

---

## [BEHAVIOR] → Invariant 映射

| BEHAVIOR | 对应 Invariant |
|----------|--------------|
| B1（push 短路） | I2, I6 |
| B2（workflow 文件全量） | I2 |
| B3（brain-tests-shell job） | I3 |
| B4（ci-passed needs） | I4 |
| B5（契约测试文件存在） | I1 |
| B6（断言一 push 事件） | I1 |
| B7（断言二 fleet-worker glob） | I1, I3 |
| B8（断言三 ci-passed needs） | I1, I4 |

---

## 静态断言检查表（本地可复现）

运行以下命令可在本地预验：

```bash
# 断言 1：changes job 含 push 事件判断
CHANGES_BLOCK=$(awk '/^  changes:/{found=1} found && /^  [a-z]/ && !/^  changes:/{exit} found{print}' .github/workflows/ci.yml)
echo "$CHANGES_BLOCK" | grep -qE 'event_name.*(==|!=).*push' && echo "PASS" || echo "FAIL"

# 断言 2：含 fleet-worker glob 行
grep -qF 'for t in packages/brain/scripts/fleet-worker/*.test.sh' .github/workflows/ci.yml && echo "PASS" || echo "FAIL"

# 断言 3：ci-passed 块含 brain-tests-shell
CI_PASSED_BLOCK=$(awk '/^  ci-passed:/{found=1} found && /^  [a-z]/ && !/^  ci-passed:/{exit} found{print}' .github/workflows/ci.yml)
echo "$CI_PASSED_BLOCK" | grep -q 'brain-tests-shell' && echo "PASS" || echo "FAIL"
```

---

## 测试文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/engine/tests/integrity/ci-blindspot-contract.test.sh` | 静态契约测试 | 三条断言，Commit-1 全红，Commit-2 全绿 |
| `sprints/07290954-ci-blindspot-fix/tests/` | 契约测试骨架目录 | 验证脚本参考实现 |

---

## DoD 完成定义

- [ ] contract-draft.md 已写入（本文件同目录）
- [ ] contract-dod.md 已写入（本文件）
- [ ] tests/ 目录骨架已创建
- [ ] packages/engine/tests/integrity/ci-blindspot-contract.test.sh 已创建（三条断言）
- [ ] 已 push 到分支 cp-07291011-ws-241578ce
- [ ] Commit-1（红）已在 Commit-2（绿）之前
- [ ] CI 全绿（ci-passed == success）
