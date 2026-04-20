## Consciousness 运行时热切换 + Dashboard UI（2026-04-20）

PR: #2457
分支: cp-0420094522-consciousness-toggle-ui
前置: PR #2447 (Phase 1 env 层开关)

### 根本原因

Phase 1 的 CONSCIOUSNESS_ENABLED 只是 env 层开关，改一下要 SSH 到主机改 plist + launchctl unload/load —— 对日常"切换意识"的使用场景（比如临时想关一下省点 token，过会儿再开）摩擦太大。理想状态应该是 Dashboard 点一下即时生效，但保留 env 最高优先级作为主机级紧急逃生口。

本次实现中踩到的坑：

1. **apps/api 是通配 proxy（`app.use('/api/brain', brainProxy)`）**而不是白名单——意味着所有新 `/api/brain/*` 端点自动透传，不需要改 proxy 层。**探测现有 proxy 模式是关键的第一步**，不然容易在 apps/api 写多余的代理代码
2. **Dashboard 的 nav + route 注册是配置驱动的**（`apps/api/features/system-hub/index.ts` 里 nav item + route + component map 统一声明），不是硬加 React Route。配置驱动的优势是加页面时只改一个地方，但代价是定位注册点要先 grep
3. **Migration 新增时，`packages/brain/src/selfcheck.js` 的 `EXPECTED_SCHEMA_VERSION` 要同步 bump + DEFINITION.md `Schema 版本` 行也要跟着改**，否则 facts-check 会拦 push。本次 subagent 误判为 pre-existing 问题，我 review 时发现并补了 commit
4. **PR size 预算更紧**：plan 文档 913 行 + spec 202 行 + 代码+测试 ~450 = 1566 行，刚好卡 1500 硬门槛边缘。**在 PR 策略里要把 docs 当作"可删除以降 size"的备用手段**，spec 保留做 audit trail，plan 完成使命后可删

### 下次预防

- [ ] **Phase N → Phase N+1 时先 grep 现有 proxy / nav / 路由 pattern**：apps/api 是通配还是白名单？nav 来自 coreConfig 还是 hardcode？component map 在 DynamicRouter 还是独立文件？这几个探测放在 brainstorming 第一步，省去后续假设错误的回退
- [ ] **加 migration 时 checklist 必须同步 4 处**：`migrations/N_*.sql` + `selfcheck.js EXPECTED_SCHEMA_VERSION` + `DEFINITION.md Schema 版本` 行 + `test/brain-manifest`（如适用）。让 facts-check 的 selfcheck_version_sync 绿是 pre-push 必过门槛
- [ ] **PR size 预算模版**：新 feature PR 目标 `spec + code + tests ≤ 800 行`；plan 文档单独算，超过 500 行就在 /dev 流程末尾默认 drop plan commit。Task 8 里写死"超 1500 就删 plan"是 tactical 的，strategic 应该是 writing-plans 阶段就控制
- [ ] **模块级 async init 的时序要 spec 化**：本次 `initConsciousnessGuard` 必须在 `app.listen` 前 await，否则请求到达时 cache 未就绪会返回 default。任何后续加 async 初始化都要显式在 spec 里标注"server.js 启动时序依赖"
- [ ] **cache + write-through 模式复用**：`consciousness-guard.js` 的 "async init → cache → setter 立即刷 cache + 异步 reload 兜底" 是很通用的运行时配置热切换 pattern，未来加 `/settings` 下其它开关（MINIMAL_MODE toggle、自驱频率等）直接复用这个 pattern 即可
- [ ] **"紧急逃生口" 语义要在 UI 里主动解释**：env_override=true 时仅 disable Switch 不够，要配文字说明"为什么不能点"+"怎么恢复"。否则用户会困惑"为啥我点不动"。本次用红色 warning panel 落地，可复制到未来类似场景
- [ ] **subagent 自动合并多个紧耦合 task 能省 context**：本次 Task 1+2+3（migration + guard ext + server/tick 集成）是紧耦合的 Brain 内部改动，交给一个 subagent 一次做完比三个 subagent 串行省一半 context + 2 轮 review 开销。判断标准：task 间必须共享类型/函数/调用链，且没有 natural review checkpoint
