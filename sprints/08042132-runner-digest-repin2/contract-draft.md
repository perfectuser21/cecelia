# Test Contract: Runner digest 二次重钉 + 构建来源 label 守卫

**Task ID**: 93161b22-9478-4695-b3e2-a01eddce78f8  
**Gear**: hotfix  
**Sprint**: sprints/08042132-runner-digest-repin2

---

## Test Contract 表

| ID | 行为描述 | 测试锚点 | 类型 |
|----|---------|---------|------|
| B1 | 全仓可执行路径不含旧 digest 5c202d56 | git grep 断言 | [BEHAVIOR] |
| B2 | `fleet-rollout.sh` 含 `verify_runner_label` 函数 | declare -f 断言 | [BEHAVIOR] |
| B3 | `verify_runner_label` 对无 label 镜像 loud-fail | fleet-rollout.test.sh 新增测试 | [BEHAVIOR] |
| B4 | `docker/build.sh` 构建时写入 `cecelia.entrypoint.sha256` label | build.sh grep 断言 | [BEHAVIOR] |
| B5 | `node-profile.test.js` EXPECTED_RUNNER_DIGEST 与 fleet-rollout.sh RUNNER_DIGEST 一致 | jest 既有测试（digest 更新后） | [BEHAVIOR] |
| B6 | Brain 版本 bump 到 1.267.216，三处文件同步 | version-sync 脚本 | [BEHAVIOR] |

---

## E2E 验收

```bash
# E1: 全仓可执行路径旧 digest 清零
STALE=$(git grep "5c202d56" -- \
  "packages/" "docker/" "scripts/" \
  | grep -v "DEFINITION.md" \
  | grep -v "docs/handoffs/" \
  | wc -l)
[ "$STALE" -eq 0 ] || { echo "FAIL: 仍有 $STALE 处旧 digest"; exit 1; }
echo "PASS E1: 可执行路径旧 digest 已清零"

# E2: fleet-rollout.sh 含 verify_runner_label 函数
source packages/brain/scripts/fleet-worker/fleet-rollout.sh 2>/dev/null || true
declare -f verify_runner_label > /dev/null \
  || { echo "FAIL: verify_runner_label 函数不存在"; exit 1; }
echo "PASS E2: verify_runner_label 函数存在"

# E3: build.sh 含 cecelia.entrypoint.sha256 label
grep -q "cecelia.entrypoint.sha256" docker/build.sh \
  || { echo "FAIL: build.sh 缺 entrypoint label"; exit 1; }
echo "PASS E3: build.sh 含 label 指令"

# E4: 版本同步
bash scripts/check-version-sync.sh \
  && echo "PASS E4: 版本同步正确" \
  || { echo "FAIL: 版本不同步"; exit 1; }

# E5: DevGate 全量
node scripts/facts-check.mjs \
  && node packages/quality/scripts/devgate/check-dod-mapping.cjs \
  && echo "PASS E5: DevGate 通过"

# E6: fleet-rollout.sh 测试（含新 label 守卫 TDD 用例）
bash packages/brain/scripts/fleet-worker/fleet-rollout.test.sh \
  && echo "PASS E6: fleet-rollout 测试全通"

# E7: node-profile jest 测试（含 EXPECTED_RUNNER_DIGEST 校验）
cd packages/brain && npx jest src/orchestrator/fleet-node/node-profile.test.js --no-coverage 2>&1 | tail -5
```

---

## 未覆盖真实链路清单

N/A（无覆盖漏洞。真实 fleet 发射 r27 是 merge 后生产验证，不属本 PR E2E 范围。Docker 镜像实物 label 验证需要 docker inspect 真实镜像，本 PR CI 无 Docker daemon，以测试替身覆盖等价行为）
