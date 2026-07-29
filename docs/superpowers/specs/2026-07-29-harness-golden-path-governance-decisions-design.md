# Harness Golden Path Governance Decisions Design

**状态：** Owner 定版 PRD 的实施设计；产品裁决不在本设计中重开
**范围：** PRD §6 ① decisions 写入，以及高风险全局 invariant 在现有 Harness 上下文中的继承
**非范围：** GP 合同、签字、Judge 合同差异、锚点回填、断言盖章、裁决记账、退役、事故库

## 目标

把 Owner 已签字的五组治理裁决写入 `decisions` SSOT，并让其中的高风险清单以
`global` invariant 身份被所有 Harness line 读取。该切片只建立权威事实和继承
入口；真正的确定性人工 Gate 在 GP 合同层切片接入，不能用 prompt 注入冒充硬门。

## 固定裁决

迁移必须以稳定 `source_ref`、`policy_key` 和 `policy_version=1` 写入以下六条记录：

1. `gp.sealing.element-criterion`：只有“每步单独回答、逐步不同、且未被四区收留”
   的属性才可能成为要素；11 要素保持封版。
2. `gp.sealing.contract-criterion`：只有“每 GP 单独回答、且必须人签字”的属性
   才可能进入七项合同。
3. `gp.sealing.rejection-template`：保存 PRD 给出的固定拒绝话术模板。
4. `gp.ownership-transfer.b`：产权变更选择 B；仅在红方接线与断言盖章同时上线后
   生效，并保存“权和闸同步交接，不裸奔”的理由。
5. `gp.high-risk.global-invariant`：权限、资金、外部发布、生产数据命中任一项时
   强制真人确认。
6. `gp.classification-and-yield-defaults`：分类存疑向上默认、Risk Tier 只升级；
   默认让路顺序为安全/资金正确性、数据一致性、功能完整、性能、体验顺滑。

每条记录的自然语言正文保存在 `decision`，机器字段保存在 `context` JSONB。
迁移幂等键使用 `source_ref`，避免重复部署生成重复的权威裁决。

## 方案选择

### 采用：扩展 `decisions.level` + 幂等 seed

给既有 `decisions_level_chk` 增加 `global`，用 migration 370 写入六条裁决。
`harness-line-context` 同时读取 `global` 与既有 `area` invariant，并按
global → area 的顺序合并。这样保留 `decisions` SSOT，不增加平行政策系统。

### 不采用：把 global 伪装成 area

现有 area 查询事实上会被每条 line 读取，但数据语义错误，后续无法可靠区分全局
铁律和具体业务区规则。

### 不采用：新增 governance_policies 表

该方案结构更整洁，但违反 PRD “写进 decisions 表”的验收口径，也会制造第二个
治理 SSOT。

## 数据与读取合同

- `category='governance'`：封版判据、拒绝模板、产权变更、分类和让路默认值。
- `category='invariant' AND level='global'`：高风险清单。
- `status='active'`、`made_by='user'`、`author='owner'`。
- `source_ref` 使用 `harness-gp-governance-prd:<policy-key>:v1`。
- `context.policy_key` 和 `context.policy_version` 是后续代码读取的稳定接口；
  `topic` 与 `decision` 是人类审计面，不作为程序分支键。

## Harness 继承

`fetchLineContext` 的 invariant 来源从 step、journey_feature、area 扩展为
step、journey_feature、global、area。去重仍以 decision id 为准；更具体的来源
优先。`formatLineContextForPrompt` 会显示 `来源: global`。

该读取仍保持现有 best-effort 行为，因为本切片不改变整个 Context Manifest 的
错误语义。后续合同 Gate 必须直接读取 `policy_key=gp.high-risk.global-invariant`
并 fail closed；不得依赖该 prompt 段来决定是否需要真人。

## 错误与幂等

- 重跑 migration 不新增重复 policy。
- 如果同一 `source_ref` 已存在，migration 更新为 Owner 定版 v1 正文和机器字段，
  并恢复为 active。
- 不按 topic 做幂等，避免中文标题修改后产生重复记录。
- migration 未应用时，新查询仍能读取旧 area invariant，但不会声称全局治理已上线。

## 测试

1. Red：migration contract 测试要求六个稳定 policy key、global level、Owner 来源、
   拒绝模板和 B 生效条件。
2. Red：line-context 测试要求查询 global + area，并证明格式化结果标注 global。
3. Green：实现 migration 和读取扩展。
4. 回归：运行 migration contract、line-context、invariant-gate 测试及 Brain 全量测试。

## 后续边界

本切片合并后只宣称 PRD ① 完成。下一切片是 ②A Skills SSOT；随后是 ②B Cecelia
合同版本、digest 签字、失效重签和确定性 Gate。③ 完成前不得合并任何④机制。
