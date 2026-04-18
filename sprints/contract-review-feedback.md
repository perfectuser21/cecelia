# Contract Review Feedback (Round 1)

**Task ID**: 0f7fec19-f9a7-41ac-81d8-81fc15be4503
**Review Round**: 1
**Verdict**: REVISION
**Reviewer**: harness-contract-reviewer (adversarial)

---

## Triple 覆盖率

- 已审查验证命令总数：17（5 Feature × 各 1-2 条 + 2 Workstream 共 8 条 DoD Test）
- Triple 分析覆盖：16 / 17 ≈ 94%（≥ 80% 阈值）
- `can_bypass: Y` 命令数：6 条（集中在 Feature 2/3 与 Feature 5 EXIT 判断）

---

## 必须修改项

### 1. [命令不可触发目标场景] Feature 2 第二条 / Feature 3 场景 A / WS1 DoD 3 / WS1 DoD 4 — `DOCKER_HOST=tcp://127.0.0.1:1` 传给 curl 完全无效

**原始命令**（Feature 2 示例，其它同类同）:
```bash
DOCKER_HOST=tcp://127.0.0.1:1 curl -s -o /tmp/health.json -w '%{http_code}\n' http://localhost:5221/api/brain/health > /tmp/health.code
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：Brain 进程启动时 DOCKER_HOST 未设置或指向本地真实 socket，
// 在命令执行时 Brain 进程根本看不到 curl 进程的 DOCKER_HOST 环境变量。
// 一个永远乐观返回 healthy 的假实现也能骗过这个命令：
function probeDockerRuntime() {
  // 完全忽略 DOCKER_HOST，直接返回 healthy
  return { enabled: true, status: 'healthy', reachable: true, version: '24.0.0', error: null };
}
// 结果：curl 拿到 status=200 + docker_runtime.status='healthy'（因为 Brain 用本地真实 Docker），
// 命令里对 reachable=false / status=unhealthy 的断言不会被检查——
// 不，更准确地说：命令里的断言会 FAIL（期望 unhealthy 但拿到 healthy），
// 但这正是问题——Generator 为通过此命令可能写出"无论如何都返回 unhealthy"的假探测模块，
// 或者更糟，这个命令在真实 CI 环境（Docker 正常）里永远 FAIL，Generator 会误以为实现有错。
// 本质：DOCKER_HOST 是给 docker cli / docker SDK 用的，不是给 HTTP client curl 用的，
// 且它是 curl 进程的 env，不传递给已启动的 Brain 进程。
```

**建议修复命令**（三选一）:
```bash
# 方案 A：以 DOCKER_HOST 错误值启动一个临时 Brain 实例，向其请求
# （需要 Generator 在实现中支持无缝端口切换；或 integration 测试内启动）
PORT=5222 DOCKER_HOST=tcp://127.0.0.1:1 node packages/brain/src/index.js &
BRAIN_PID=$!
sleep 2
curl -sf http://localhost:5222/api/brain/health > /tmp/h.json
kill $BRAIN_PID
node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/h.json','utf8')).docker_runtime; if(d.reachable!==false||d.status!=='unhealthy'||typeof d.error!=='string'||!d.error.length)throw new Error('FAIL'); console.log('PASS')"

# 方案 B（推荐）：把"Docker 不可达"场景的验证完全下沉到 integration 测试（Feature 5 已覆盖），
# live 端点层面只验证 happy path + 响应耗时 ≤ 3000ms，
# 删除 Feature 2 第二条、Feature 3 场景 A/B、WS1 DoD 3/4 中所有 DOCKER_HOST=... curl ... 命令，
# 改由 WS2 integration 测试（Jest spy/mock probe 模块）承担，CI 可执行且无副作用。

# 方案 C：Brain 提供 test-only endpoint 注入 probe mock（POST /api/brain/__test__/mock-probe），
# 验证命令先 POST 注入 mock，再 GET health 断言，测试后 POST 清除。需要新增 test-only API。
```

---

### 2. [命令不可触发目标场景] Feature 3 场景 B — `DISABLE_DOCKER_RUNTIME=true curl ...` 同样无法影响已启动的 Brain

**原始命令**:
```bash
DISABLE_DOCKER_RUNTIME=true curl -sf http://localhost:5221/api/brain/health | node -e "..."
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：Brain 启动时未设置 DISABLE_DOCKER_RUNTIME，进程内此变量 undefined，
// Brain 的配置读取逻辑（process.env.DISABLE_DOCKER_RUNTIME）为 undefined。
// curl 进程设置的环境变量对已启动的 Brain 进程完全不可见。
// 结果：docker_runtime.status 永远不会变成 'disabled'，命令走 SKIP 分支（见 Issue 3），PASS。
const config = { dockerEnabled: process.env.DISABLE_DOCKER_RUNTIME !== 'true' }; // Brain 启动时已冻结
```

**建议修复命令**: 同 Issue 1 方案 B — 由 integration 测试（Jest 重新 require 模块 + 改 process.env）承担此场景。live 验证命令中移除。

---

### 3. [假阳性 SKIP 分支] Feature 3 场景 A / 场景 B — 未满足触发条件时走 SKIP 通过，假实现零成本绕过

**原始命令**（场景 A）:
```bash
DOCKER_HOST=tcp://127.0.0.1:1 curl -sf http://localhost:5221/api/brain/health | node -e "
  const b = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (b.docker_runtime.enabled === true && b.docker_runtime.status === 'unhealthy') {
    if (b.status !== 'degraded') throw new Error('FAIL: 期望顶层 degraded，实际 ' + b.status);
    console.log('PASS: unhealthy+enabled 聚合为 degraded');
  } else {
    console.log('SKIP: 未满足触发条件（需 enabled=true 且 unhealthy）');  // ← 假阳性路径
  }
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：聚合逻辑完全未实现，顶层 status 永远是 'healthy'，
// 但由于 Issue 1/2 的原因，docker_runtime.status 永远不是 'unhealthy'（本地 Docker 正常），
// 命令走 else 分支，输出 SKIP，退出码 0，Evaluator 判为 PASS。
function aggregateStatus(organs, dockerRuntime) {
  // 故意不处理 docker_runtime，直接返回 healthy
  return 'healthy';
}
// 这个假实现在合同所有 Feature 3 命令下都能通过。
```

**建议修复命令**:
```bash
# 删除 SKIP 分支。场景触发本身应由命令的 setup 步骤强制（见 Issue 1 方案 A/B/C）。
# 若采用方案 B（integration 测试承担），则 Feature 3 的 live 命令改为"正常场景下顶层 status=healthy"断言：
curl -sf http://localhost:5221/api/brain/health | node -e "
  const b = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  // 正常场景：docker healthy → 顶层 healthy（排除其它器官故障）
  if (b.docker_runtime.status === 'healthy' && b.status !== 'healthy') {
    const cbOpen = (b.organs?.circuit_breaker?.open || []).length > 0;
    if (!cbOpen) throw new Error('FAIL: docker healthy 且无 cb open 时顶层应 healthy，实际 ' + b.status);
  }
  // disabled 场景：顶层不得因此降级（集成测试里覆盖）
  console.log('PASS: live 聚合一致性断言');
"
# unhealthy + degraded 聚合的断言完全由 integration 测试（WS2）承担。
```

---

### 4. [退出码读取错误] Feature 5 验证命令 2 — `EXIT=$?` 在管道后读到的是 `tail` 的退出码，不是 `npm test` 的

**原始命令**:
```bash
cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration' 2>&1 | tail -20
EXIT=$?
[ "$EXIT" = "0" ] && echo "PASS: brain integration 测试通过" || (echo "FAIL: 测试失败 exit=$EXIT"; exit 1)
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：integration 测试完全写错，npm test 失败 exit code 1。
// 但命令里 `| tail -20` 之后，$? 读到的是 tail 的退出码（tail 总是成功 = 0）。
// 结果：npm test FAIL → tail 成功 → $?=0 → 命令判 PASS，假实现通过。
describe('docker_runtime', () => {
  it('should have docker_runtime field', () => {
    expect(true).toBe(false);  // 永远失败
  });
});
// npm test exit=1，但 tail -20 读完管道后 exit=0，EXIT=0，命令误报 PASS。
```

**建议修复命令**:
```bash
# 使用 PIPESTATUS（WS2 DoD3 已正确使用，此处保持一致）或 set -o pipefail
cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration' 2>&1 | tail -20
EXIT=${PIPESTATUS[0]}
[ "$EXIT" = "0" ] && echo "PASS: brain integration 测试通过" || { echo "FAIL: 测试失败 exit=$EXIT"; exit 1; }

# 或使用 pipefail：
set -o pipefail
cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration' 2>&1 | tail -20
EXIT=$?
[ "$EXIT" = "0" ] && echo "PASS" || { echo "FAIL: exit=$EXIT"; exit 1; }
```

---

## 可选改进（非阻塞）

- Feature 2 使用 `/tmp/health.json` `/tmp/health.code` 临时文件，多次运行可能污染；建议用 `mktemp` 或 stdin/stdout 管道替代。
- Feature 1 HTTP 状态码检查（第二条命令）与 node 块（第一条命令）有部分重叠，可合并为单个 node 调用，减少 curl 次数与并发态差异。
- Workstream 1 "Docker 探测模块文件由实现者定" 建议明确文件路径（`packages/brain/src/docker-runtime-probe.js`），避免 Generator 与后续 DoD Test 路径 drift（DoD 第一条已硬编码此路径，Workstream 范围描述应对齐）。

---

## 总结

合同整体结构完整（5 Feature / 2 Workstream / 5 AC 对齐 PRD FR-001~005 / SC-001~004），覆盖度充分。但 **live 验证命令中 3 处环境变量传递错误 + 1 处退出码读取错误 + 2 处 SKIP 假阳性路径** 会让 Generator 的错误实现（不处理 Docker 不可达 / 不处理聚合规则 / 测试全部失败）轻松通过验证，违反"合同必须能检测错误实现"的 GAN 核心约束，必须修复后重提。

修复核心方向：**将"Docker 不可达 / disabled / 聚合 degraded"三类场景的验证完全下沉到 WS2 integration 测试（Jest mock probe 模块），live 端点命令只保留 happy path + 响应耗时 + 结构兼容性断言**。这样合同既能检测错误实现，又避免 CI 对 Docker daemon 状态产生副作用。
