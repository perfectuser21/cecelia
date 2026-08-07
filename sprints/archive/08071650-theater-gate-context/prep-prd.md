# 小改动 PrepPRD:theater 闸语境化 + GP 胶水参数化(D2 回 Harness 前置修债)

> task d2567378-babb-4d7d-808c-968186223a8b;决策:Alex 08-07 拍板 D2-D5 回 Harness,本单是唯一技术前置。
> anchor: journey=e6f803f2(工厂·F1 开发闭环) none-step;repo=cecelia

## 债1:theater 闸语境化(packages/brain/src/harness-judge.js:783-822 一带)

现状:THEATER_KEYWORDS(android/真机/RPA/adb/微信/UIA/xian-rog…)对合同 BEHAVIOR/Test 行与 sprint-prd 的 Golden Path 段做大小写不敏感 substring,命中 + target_environment ∈ THEATER_LIGHT_ENVS(local_api/mac_web) → theater_mismatch FAIL。误杀形态:合同**引用**真机名词(文件名 line02-android.yaml/格号语义)但零真机动作的项目。

修法(fail-closed 不放水):
1. 关键词命中+轻量环境时,先查合同是否含「## 真机边界声明」段(固定标题):声明本合同引用的真机名词清单+承诺零真机动作+理由。
2. **无声明 → 行为与现行完全一致(FAIL)**——存量合同零行为变化。
3. 有声明 → 二次交叉验证:BEHAVIOR/Test 行不得命中**动作性词表**(与名词引用分表:adb shell/adb 、UIA、schtasks、真机执行、安卓端操作、真机点击、驱动真机、windows_wechat 派发……动作词表从现有 THEATER_KEYWORDS 里拆出+补充,名词引用词如 android/安卓/真机 留在名词表)。动作词命中 → 仍 theater_mismatch FAIL(声明不能洗白真作弊),FAIL 详情注明"声明存在但动作词命中:<词>"。
4. 声明+纯名词 → PASS 放行,judge 输出记录 theater_declared:true 留痕。

## 债2:GP 胶水参数化(packages/brain/src/golden-path-contract-task.js:1-2 + golden-path-contracts.js:397-398)

现状:GP_HARNESS_BASE_REPO='…/cecelia.git' 与 GP_HARNESS_TARGET_ENVIRONMENT='local_api' 是不可覆盖常量 → 任何跨 repo/非 local_api 的 GP 自动转 harness 走不通。

修法:migration 393 给 golden_paths 加两列 base_repo(text null)/target_environment(text null,CHECK ∈ 六枚举或 NULL);转合同任务时优先读 GP 行的两列,NULL 回落现常量(存量 GP 零行为变化);target_environment 写入 payload 时同枚举校验。

## 验收标准
- [ ] judge 单测四象限:无声明+名词=FAIL(回归,现行为)/有声明+纯名词=PASS+theater_declared/有声明+动作词=FAIL 带词/无关键词=PASS(回归)
- [ ] migration 393 up/down 可逆;两列 NULL 回落常量的单测;非法枚举 CHECK 拒绝
- [ ] DevGate 三件套过;版本 bump(minor:1.269.0→1.270.0,含 migration);EXPECTED_SCHEMA_VERSION 393;kernel smoke 地板 392→393 同步(上一单的教训)
- [ ] 每改动 failing test 先行(TDD)
