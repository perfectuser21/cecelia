# Contract DoD: Runner digest 二次重钉 + 构建来源 label 守卫

**Task ID**: 93161b22-9478-4695-b3e2-a01eddce78f8

---

[BEHAVIOR] B1: 全仓可执行路径旧 digest 5c202d56 已清零
- 断言：`git grep "5c202d56" -- packages/ docker/ scripts/ | grep -v DEFINITION.md | grep -v docs/handoffs/ | wc -l` 输出 0
- manual:bash: `[ "$(git grep "5c202d56" -- packages/ docker/ scripts/ | grep -v DEFINITION.md | grep -v docs/handoffs/ | wc -l)" -eq 0 ] && echo PASS || echo FAIL`

[BEHAVIOR] B2: fleet-rollout.sh 含 verify_runner_label 函数
- 断言：`source packages/brain/scripts/fleet-worker/fleet-rollout.sh 2>/dev/null; declare -f verify_runner_label` 成功返回
- manual:bash: `(source packages/brain/scripts/fleet-worker/fleet-rollout.sh 2>/dev/null && declare -f verify_runner_label > /dev/null && echo PASS) || echo FAIL`

[BEHAVIOR] B3: verify_runner_label 对无 label 镜像 loud-fail（TDD，proven-to-fire）
- 断言：fleet-rollout.test.sh 中新增 label 守卫测试用例通过，且在实现前跑红（commit 顺序证明先红后绿）
- manual:bash: `bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh && echo PASS || echo FAIL`

[BEHAVIOR] B4: docker/build.sh 写入 cecelia.entrypoint.sha256 label
- 断言：`grep -q "cecelia.entrypoint.sha256" docker/build.sh`
- manual:bash: `grep -q "cecelia.entrypoint.sha256" docker/build.sh && echo PASS || echo FAIL`

[BEHAVIOR] B5: EXPECTED_RUNNER_DIGEST / fleet-node-profiles.json / RUNNER_DIGEST 三处均为新 digest
- 断言：`grep ae2eaabba packages/brain/src/orchestrator/fleet-node/node-profile.test.js packages/brain/scripts/fleet-worker/fleet-rollout.sh packages/brain/config/fleet-node-profiles.json | wc -l` ≥ 5
- manual:bash: `[ "$(grep -c ae2eaabba packages/brain/src/orchestrator/fleet-node/node-profile.test.js packages/brain/scripts/fleet-worker/fleet-rollout.sh packages/brain/config/fleet-node-profiles.json)" -ge 5 ] && echo PASS || echo FAIL`

[BEHAVIOR] B6: Brain 版本同步 1.267.216，三处文件一致
- 断言：`bash scripts/check-version-sync.sh` 输出 "All version files in sync (1.267.216)"
- manual:bash: `bash scripts/check-version-sync.sh | grep -q "1.267.216" && echo PASS || echo FAIL`

---

## DoD 检查清单

- [x] TDD：先写 failing test（fleet-rollout.test.sh label 守卫），commit 后为红
- [x] 实现 verify_runner_label 函数 + build.sh label 写入后绿
- [x] 所有文件旧 digest 替换完毕
- [x] DEFINITION.md 历史条目不改，追加新条目
- [x] Brain 版本 bump + 三处同步
- [x] DevGate 三件套全通
- [x] CI 全绿
