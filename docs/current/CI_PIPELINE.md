---
id: current-ci-pipeline
version: 2.0.0
updated: 2026-11-01
authority: CURRENT_STATE
---

# Cecelia CI：最小保障与独立诊断

配置以本分支 `.github/workflows/` 和 `scripts/ci/` 为准。GitHub 合并保护是独立的外部配置，迁移时必须读回核对；修改 YAML 不会自动更新保护规则。

## 最低保障

`ci.yml` 是 PR 和 main 的源码验证入口。最终合并检查名为 **源码保底通过**（job id 为 `ci-passed`）。新名字用于切换：旧 PR 的旧绿灯不能自动继承新基线资格。

| 顶层任务 | 实际责任 | 失败含义 |
|---|---|---|
| plan | 真实 Git 差分选择完整组件；main/按需调用运行现役服务全量 | 无有效差分、未知 revision、计划异常都不能继续 |
| security | Gitleaks 凭据扫描、运行依赖 high+ 与全依赖 critical 审计 | 缺失/错误报告、工具异常或未豁免漏洞均失败 |
| checks | 按组件执行真实单测、类型检查、构建、Shell 回归、镜像和隔离运行验收 | 任一实际进程非零或信号退出均失败 |
| ci-passed | 等待 plan/security/checks，三者都必须 success | skipped/cancelled/空值/未知值均不能通过 |

检查计划使用 `basic-scope.mjs`，实际命令使用 `run-basic-check.mjs`。没有重复维护几十个汇总依赖的清单。

| 组件 | 保障内容 |
|---|---|
| Brain | 完整原生单测六分片；第一片还跑 lint 与全部 Fleet Shell 回归 |
| Brain runtime | 新建专用 PG 后执行正式迁移；启动当前源码；HTTP 任务生命周期与KV读写、独立SQL读回；交接文件仅进本人临时目录；真实SIGINT/SIGTERM回归确认本人进程关闭并清理目录 |
| Brain image | 使用正式 Dockerfile 构建真实镜像 |
| Engine | 类型检查、完整原生单测、unit/integration/integrity Shell 回归及构建 |
| API | 类型检查、完整单测和编译 |
| API PG | 临时HTTP服务与每文件私有scratch schema，memory/planning/dev-session共45项真实合同；缺DB或未知外连失败，收尾关闭HTTP与pool并删除本人schema |
| Dashboard | 完整单测和生产构建 |
| Quality / MCP | 各组件单测；Quality 历史共享服务探测已改为隔离 HTTP 测试 |
| Ops | 部署、预览、镜像保留与回退、Runner、进程清理等既有 Node/Shell 夹具；自动发现同类新增测试，关键类别为空即失败 |
| scripts | CI 自身行为回归、事实/版本一致性、迁移同号与 Skill 所有权检查 |
| Android | 仅相关客户端改动选择 Gradle/JVM 测试，纳入同一个 ci-passed |
| frontend | 路由表标记 Legacy/deploy:false；现役发布使用 apps/dashboard。旧目录自身变更仍检查构建和浏览器；未修改旧应用不阻断现役服务全量 |

Brain/Engine/API 的共享依赖变更会选择共享运行组及 Ops 回归；全局脚本、依赖和配置变更保守选择现役服务全量。未知可执行路径不会被当成纯文档略过。只有明确的文档路径/文件名走轻量检查，仍运行 CI 自身回归和安全扫描；运行时 Markdown 提示词按所属组件检查，MDX 不按普通文档免检。

配置文件名按分段判断，包含大量点号的合法路径不能拖垮范围选择。历史 Sprint 的文档记录仍走轻量检查，目录中的代码、JSON 和 MDX 保守验证。Engine 测试的固定 Shell 正文写入本人临时脚本再执行，路径通过位置参数传递，避免通用 `bash -c` 封装混淆命令正文与数据；保留恶意路径、退出码和清理的真实回归。

普通源码 CI 使用一次性本机 `cecelia_scratch` 和固定测试口令；不需要生产账号、内网、模型服务或私有 Skill 仓库访问密钥。运行验收强制拒绝远端和非 scratch 数据库。

数据库 URI 只注入实际 PG 跑道，避免单测文件里的条件集成用例被环境变量意外启用。混合文件的原生断言留在单测，其真实 PG 用例由深度配置显式执行。

深度夹具也必须隔离：影响半径和任务列表使用本人私有 schema；部署后批次过滤使用正式迁移列结构的临时 tasks 表，真实执行 verifier 并独立读回。测试不能默认连接生产库，也不能让批次扫描其他测试的任务。

外置 Skill 正文合同使用独立的 `skill-source-tests.mjs` 集合和各组件专项配置，归 `Pinned Skill Sources`：恢复固定 revision、校验 46 份投影后真实执行。普通单测保留原生 loader、prompt、launcher、Runner、callback 与 Judge 机制，用隔离 provider/cwd/HOME 验证；不以本机私有正文是否存在决定这些测试是否运行。已明确停用的 Reviewer v5 合同不计入任何通过保障。

完整组件测试保留各包已声明的测试范围；它不等于所有历史测试均健康。现存 exclude/skip 不因本次重整而被解释为业务正确。

审计清理按实际保障归并：API 意图识别与 Brain 判级仅保留一份同环境回归；账龄测试统一在真实函数的 `.js` 测试中，保留 F6 回归并验证查询、计数、间隔与告警边界；Dashboard 全景测试直接导入产品组件。三个账龄空骨架、组件复制实现及已删除旧图实现的停用合同退出测试发现。代表性错误变体在专用副本中验证，不能改坏共享源码来制造红灯。现役 API 的三个历史skip已迁入独立PG跑道；两份watchdog crisis测试修正过期平台fixture后回到默认测试，API巡查的旧skip改为隔离真实子进程。故意拒绝旧运行时复活的负例继续保留，不能因为路径不存在就自动删除。

## 深度回归

`nightly-regression.yml` 每夜/按需运行：

| 跑道 | 用途 |
|---|---|
| brain-integration | 用正式迁移和独立 PG，运行共享数据库清单及 integration 目录回归；显式 POSTGRES_INTEGRATION=1 |
| walking-ci-e2e | 历史 Walking demo 的真实容器 callback、PG checkpoint 和重启恢复 |
| real-env-smoke | Map Manifest 的授权真实 PG 正例；普通单测不获得写授权 |
| open-issue-on-failure | 深度回归失败时记录对应 job 和运行链接，按日期去重 |

深度回归不替代最低源码保障；源码绿色也不代表自动调度、真机执行或生产发布已通过。旧单分片近似覆盖率与缺产物即通过的“80%门禁”已移除，不再宣称提供全量覆盖率保证。

## 独立职责

| 工作流 | 定位 |
|---|---|
| implementation-impact.yml | 来源准入；所有目标main的PR、main push与按需调用均执行，保留真实差分与来源资格保护 |
| skill-source-ownership.yml | 所有权专项的单元测试及真实校验；最低 scripts 跑道也运行同一校验器，专项继续作为独立必需检查 |
| skills-source-check.yml | 固定 Skill 来源的三系统恢复校验及 Brain/Engine/Quality/root 正文合同；所有目标main的PR与main push执行，固定Skill合同通过严格汇总全部结果 |
| ci-dashboard-pwa-e2e.yml | 当前 Dashboard 的 PWA/任务台浏览器专项 |
| skill-distillation-eval.yml | 按需运行固定截图的真实在线模型评测；沿用原阈值和凭据引用，服务或报告失败真实报红，不作为所有源码 PR 的前置条件 |
| app-server-canary / attempt-runtime-limits / linux-resource-canary / node-onboarding / us-price-lease | 各组件按路径触发的专项回归 |
| preview-deploy / preview-cleanup | 当前 Apps 的预览环境创建与回收；依赖更新 bot 不占预览环境 |
| auto-staging-deploy / deploy / brain-ci-deploy / pilot-release-verification | 发布与来源资格；以 GitHub 启用状态、宿主发布脚本和实际回执为准 |
| heartbeat-sentinel / ci-red-alert / verify-tailscale-brain | 运维监控、告警与连接诊断 |
| archive-learnings / cleanup-merged-artifacts / auto-version | 仓库维护；不是代码正确性证明 |

`cecelia_source_only` 及生产拒绝逻辑保留。来源准入失败应报告未就绪，不能通过删除来源保护来获得“全绿”。

来源选择器机制测试使用不可变历史 Git 样本，保留真实字节、AST、篡改、超时和缓存验证；另验证当前候选仍不能继承该样本资格。机制测试通过不等于候选来源已准入，实际 Implementation impact 继续独立判定当前修订。

## 已退出自动通用门禁的旧入口

| 入口 | 处理理由 |
|---|---|
| harness-v5-checks | 旧 Sprint 合同纯度、测试形状和提交顺序；仅保留按需兼容诊断 |
| ci-smoke-glob-runner | 旧 allow/debt/deny 全池；按需诊断，最低运行验收由真实任务生命周期承接 |
| integration-nightly | 旧接口夹具与重复夜间入口；完整数据库回归已集中 |
| nightly-real-machine / smoke-e2e-nightly | 假定常驻 5222 与历史任务 ID；按需环境诊断，不冒充每个源码版本的验收 |
| pr-review | 在线 AI 辅助审查按需调用，不再自动依赖付费 API 或截断 diff 判合并资格 |
| ci-l5-e2e-frontend | 旧应用浏览器诊断按需调用 |
| ci.yml 内旧 DoD 动态 eval、TDD 顺序、Learning 格式、分支名、PR 大小、正则测试形状与台账棘轮 | 不构成最低源码正确性证明；实际行为与 Shell 回归仍归属相应组件 |

开发前仍遵循 AGENTS.md 的 DevGate 和 PR 流程。退役工作流形状断言已迁到真实范围选择、失败传播、隔离和业务行为测试，不用把旧任务名留在新 CI 中来满足历史字符串测试。

本地 `quickcheck` 负责快速准备：Brain lint、Engine/API 类型检查、Dashboard 构建；CI 或根依赖变更还运行 scripts 检查。保留互斥锁、真实差分、格式和失败阻断；DoD 使用正式 Test 映射校验，允许后续验收如实保持未完成。本地通过只表示准备完成，完整组件测试集中由 GitHub 的统一门禁验收。

## 本地复核

```bash
npm ci --ignore-scripts
node scripts/ci/run-basic-check.mjs scripts
node scripts/ci/run-basic-check.mjs api
node scripts/ci/run-basic-check.mjs dashboard
node scripts/ci/run-basic-check.mjs brain-unit 1
```

运行数据库验收需自行创建本机专用临时 PG 并显式设置 DATABASE_URL/DB_*；不读取默认生产连接。CI 的 service 自动提供该资源。禁止把用户现有服务或生产库当测试夹具。

## 外部切换验收

1. 固定候选 SHA 的源码 CI 真正通过。
2. 读回 GitHub required checks；以 `源码保底通过` 和 `固定Skill合同通过` 替换旧 Harness/Smoke/ci-passed，继续要求 `Skill source ownership` 的专项单测与校验，以及 `Implementation impact gate` 的真实来源准入。四个必需检查均对所有目标main的PR产生结果。
3. 保留 strict、管理员受限、禁止强推及 PR 要求；规则变更不能被描述为测试证据。
4. 合并后读回 main 对应 SHA 的真实 CI；生产就绪仍由独立发布/来源保护判断。

第二批清理保留真实行为：能力向量CLI、capture triage、Radius→cascade、通知缓存、预算接口、进程诊断和GTD页面不再测试常量或复制实现。意识门控以语法控制流验证，不以附近50行文本判断。五份旧alertness规格迁到现役native入口并同步注册表；OOM旧毕业副本由原生回归及真实HTTP退出码写回替代。

CI自检直接解析维护中测试：新增字面量自比较不能通过，字符串fixture和真实函数结果不误报。这个窄规则只拦显然空断言，不把所有字符串匹配判为垃圾。测试替代还需真实错误变体与独立审查。源码变体只在隔离副本或加载器内存中执行，不改坏共享源码。

provenance测试仅复用不可变的初始Git夹具，每例使用私有可写副本；并发push必须互不污染。保留了完整实测有收益的record夹具优化；source-merge收益受抖动影响，已恢复原实现，不以删行数或理论估算承诺提速。

Node测试入口仅接受匹配名称的普通文件；同名目录、符号链接及空集合直接失败，避免Node递归发现超出已证明的执行范围。来源选择器严格对应Deep实际glob与排除规则，隐藏目录和node_modules不能凭路径名获得“已执行”关系。

排除项不再作为一整块“数据库测试”隐藏：27份隔离测试恢复默认执行，连同额度耗尽保护和真实executor孤儿恢复，共29文件418项通过默认配置。两份逐字相同的额度测试归并；两份已退役initiative推进规格由现役不查数据库、返回零变更的守卫承接。

`scripts/ci/brain-test-debt.json` 精确登记剩余69份未被自动配置接收的测试：7份隔离夹具、59份真实资源依赖、3份旧规格。CI按实际维护glob与源码/Deep/Pinned/real-env入口计算差集；新增遗漏或清单漂移报错。root手动配置不计自动保障，配置接收也不等于文件内全部用例实际通过，59份资源测试本轮未执行。
