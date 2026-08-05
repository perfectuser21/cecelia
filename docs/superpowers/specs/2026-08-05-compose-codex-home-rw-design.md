# compose codex-team 挂载 :ro→:rw 设计（codex 0.146 可写 CODEX_HOME）

Brain task: b1731846；决策 c62c423a。前置：PR #4640 已部署（容器 codex 0.146.0）。

## 问题（容器实测）
codex 0.146 启动需写 CODEX_HOME（cache/sessions/mcp-oauth-locks，实测清单），:ro 挂载下报
`failed to initialize in-process app-server client: Read-only file system`。最小可写 home 实测出活且 auth.json 未被改写。

## 修法（Research 已核）
1. `docker-compose.yml:47-51` 五行 `.codex-team1~5` 挂载 `:ro`→`:rw`（全仓唯一挂载点；staging/dev/e2e 无 codex 引用）。同步更新 44-46 行"只读挂载"注释。
2. `packages/brain/src/orchestrator/preflight/production-compose.test.js:17-21` 既有 `:ro` 断言反转为 `:rw`——它就是守卫（TDD：先反转=红，改 compose=绿）。
3. `packages/brain/package.json` version bump（check-brain-version-bump.sh 强制；且 SHA 变化绕过 brain-deploy 幂等跳过，compose up -d 自动 recreate 吃新挂载）+ DEFINITION.md 版本同步（facts-check 闸）+ 两份 package-lock 同步。

## 理由
可写共享 home = 容器即宿主上另一个 codex 客户端（宿主本就多 session 并发同一 home）；auth 同一份无副本分歧。:ro 无决策背书（随 #2833 顺手写）。

## 测试策略
unit：production-compose.test.js 反转断言（先红后绿）；integration：merge 部署后 docker inspect 确认五路 rw=true + 容器内 codex exec 真跑；E2E：真实 arch_review 派发跑通（终验）。
