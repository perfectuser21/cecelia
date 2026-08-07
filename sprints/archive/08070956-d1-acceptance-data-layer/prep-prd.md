# 小改动 PrepPRD:D1 数据层地基与状态机(验收一体两面第一刀)

> 规格 SSOT = golden_paths(7790f728).proposal_doc = sprints/f2-acceptance-two-column/proposal-v7-final.md 的「D1 · 数据层地基与状态机」节(本文件只是执行摘要,冲突以 v7-final 为准)。
> 决策链:fdeb48aa(架构六条) + 08-07 拍板(J17=B/场景mandatory/S13-c4人判裁决,decisions 表有记录)。
> 本任务 task_id=b35bfa0c-c798-45a5-80dc-16f12e35ca6d(已 claim);decision 不重复写库——拍板决策已覆盖本改动方向。

## 改什么(全在 cecelia packages/brain,repo=cecelia)

1. **AI 四列 migration**:acceptance_checks 加 ai_verdict/ai_evidence/ai_run_at/adjudication(中文枚举 通过/不通过/无法验证 + CHECK,J6-A)
2. **格号统一**:check_key 改规程格号 S{n}-c{m};约束改 UNIQUE(run_id, check_key)(J5-A);submitAcceptanceResults 全链路加 run_id 作用域
3. **run 状态机 7 值**:369_acceptance_tables.sql:11 CHECK 扩为 pending/in_review/human_complete/adjudicated/stale/expired/abandoned(passed/failed 退为历史兼容);acceptance.js:88 三元式同批替换;终态是 status 取值不是 detail 旗标
4. **格级/run级分离**:新增 final_state/gate_verdict 计算(九组合矩阵,作用域=格,Q0′缺格恒判未定);run status 独立走状态机,不由格级推导
5. **36 格建单生成器**:规程 yaml → 建行(排除集=na:true ∪ fixedNa 步骤全格;含 kind,J14)
6. **yaml 静态属性收口**:scenario_required→scenario_class 三值枚举迁进 yaml(mandatory 5:S4-c2/S4-c3/S5-c3/S5-c4/S10-c4;opportunistic 0;unverifiable_this_version 1:S13-c4);verifiable_by 只改 S13-c4 一格(machine_db→human_only)
7. **yaml op 加厚**(拍板②):S5 op 追加"手动让其中一个小号退出登录/断网";S10 op 追加"同一关键词再发起一次采集对照覆盖"——与本批同 spec_sha 上线
8. **版本戳落库**:backend_sha/frontend_sha 双源对账 + spec_sha/version(J12)
9. **哑火判据**:detail.ai_status 三条件(条件②分母 19 格阈值 ≥10)
10. **服务端 reason 校验**:reason=human_only 而格非 human_only→400;reason=scenario_not_triggered 任何格→400(合法域空集)
11. **run 生命周期**:pending 48h 过期扫描器(→expired) + 显式作废端点(→abandoned 留痕)
12. **建单前置校验+逃生阀**:同 gp 上轮 review_closed_at 非空否则 409;force_reason≥20字放行留痕;单头 tenant_account∈验收专用租户(下拉)
13. **收单推进闸**(拍板②):scenarios_observed[] 未勾齐 5 个 mandatory 场景码→run 拒收 AI 回写(409 含缺失清单)
14. **review-closed/review-ack 端点**:主体校验(员工 403)+全员 ack 或满 24h 前置闸+24h 兜底防死锁

## 注意:yaml/规程文件在 zenithjoy-workspace(第6/7条)
acceptance-spec/line02-android.yaml 及 schema 在 zenithjoy-workspace repo——这两条产出为 zenithjoy 侧独立小 PR,其余全在 cecelia。两 PR 同批合并(spec_sha 一致性)。

## Gate B 首日清单留痕(v7-final 要求 D1 开工前)
- 第1项(5223 公网可达):✅ 已实测——公网 /acceptance/catalog 返 401(隧道活/鉴权墙在,demo 阶段留痕);闸侧回写侧各有回落
- 第2项(第三把 env 可注入):部署配置检查,D3 实现时同批验证(缺钥匙只降级的代码属 D3)
- 第3项(托管 runner 真跑 capture 登录,阻塞项):**属 D2 前置**,对 D1 的影响仅哑火分母常量(19/10);D1 开工与其并行,若 B 改道回落成本=改常量+口径表重算,已知可控。此为对 v7-final"D1 前跑完"的显式偏离,理由留痕
- 第4项(S4-c2 三档取数):档3 有公式回落,不阻塞

## 影响范围
acceptance_runs/acceptance_checks 表(migration,生产库)、routes/acceptance.js、新增生成器脚本;Staff Hub 现有三页面读接口不破坏(列白名单属 D3,本刀只加列不减列);DevGate 三件套必过

## 验收标准(从 v7-final 断言派生,D1 解锁 A1/A3/A5/A9/A10/A15 的服务端部分)
- [ ] migration up/down 可逆;psql \d 验 AI 四列+UNIQUE(run_id,check_key)+7值 CHECK
- [ ] 建单生成器对 line02-android.yaml 产出恰 36 行,格号 S{n}-c{m},kind/verifiable_by/scenario_class 齐全;S14 全步+na 格零建行
- [ ] 同 gp 第二轮 run 建单不再 23505
- [ ] 人列含"不通过"的 run 不落 failed,走 human_complete 链路(A10⑤ 回归测试)
- [ ] reason 非法组合 400(A4⑥⑦);scenarios_observed 缺码时 AI 回写 409(A16①)
- [ ] review-closed 五场景(A15①-⑥):未闭环建单 409/员工 403/未 ack 未满24h 403/全员 ack 200/24h 兜底 200/force_reason 逃生阀
- [ ] 每条新行为先有 failing test(TDD commit-1)再实现(commit-2);CI 全绿;DevGate 三件套过
