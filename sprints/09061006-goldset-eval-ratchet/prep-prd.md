# PrepPRD：Crystal 件5（手动v3）— 金标集 v0 + LLM判定器 eval 通过率棘轮进 CI

> 状态：Alex 已三次拍板（速度开工），本文件为落地存档。
> Brain task: e81be649-b3b2-4cb9-9908-b8075dff937c（人工worker批次，勿派kernel）
> 依据：memory skill-distillation-ab-verified.md（09-05 真机 A/B 实测）+ 决策 ca9f3d7b / 28ca1f69

## 本次要做的

把 09-05 A/B 实验验证过的「技能体+registry+契约」路线中**可进 CI 的纯代码部分**固化进 cecelia repo：

1. **金标集 v0**：五类截图（用户列表页=true；桌面/计算器/搜索历史/联想页=false）。
   xian-m4 `/tmp/ab/` 原素材已被清理 → 用同一台真机（HONOR MAA-AN00）按 memory 规格重抓，
   文件名带 label+timestamp（吸取「截图按步号复用只剩最后一轮证据」的坑）。
2. **LLM 判定器 eval 进 CI**：判定器在金标集上通过率 ≥ 阈值；输入固定（静态截图），
   断言形式 = 通过率 ≥ 阈值。
3. **阈值棘轮只许升**：阈值登记进统一棘轮台账 `scripts/ratchet-registry.json`
   （direction=only_up），ratchet-guard 每 PR 守护，调低即红。
4. **四条纯代码用例**（vitest，quality-tests job 每 PR 跑，无需手机）：
   - ①技能体序列固化断言（mock 依赖注入，断言动作顺序）
   - ②registry 缓存命中必须零视觉调用（防成本回归）
   - ③视觉定位返回 null 必须 fail-closed（不许瞎点）
   - ④契约完备性 lint（每技能必须声明 pre + post + side_effects）

## 涉及文件

- `packages/quality/skill-distillation/src/runtime.mjs` — 技能体+四级降级链（依赖注入重构版，SSOT 源自 xian-m4 ~/ab-test/ab.mjs）
- `packages/quality/skill-distillation/src/contracts.mjs` — 技能契约表（pre/post/side_effects/sequence）
- `packages/quality/skill-distillation/src/judge.mjs` — LLM 判定器（prompt 构造 + fail-closed 解析）
- `packages/quality/skill-distillation/goldset/manifest.json` + `*.png` — 金标集 v0
- `packages/quality/skill-distillation/eval-threshold.json` — 通过率阈值
- `packages/quality/skill-distillation/scripts/goldset-eval.mjs` — eval runner
- `packages/quality/tests/skill-distillation/*.test.ts` — 四条用例
- `scripts/ratchet-registry.json` + `scripts/ratchet-guard.mjs` — 新指标 goldset_eval_threshold
- `.github/workflows/ci.yml` — 新 job goldset-eval（paths 过滤，TOAPIS_API_KEY secret）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 截图是否「搜索结果用户列表页」 | 视觉LLM判定 / uiautomator XML | 视觉LLM（HONOR 上 uiautomator 必死"could not get idle state"） | 09-05 实测 | eval 通过率失真→棘轮误红/误绿 |
| eval 外部服务(toapis)不可用时 | skip / fail | fail（诚实红，failure-without-reason 反面） | paths 过滤已把爆炸半径限制在 skill-distillation 变更 | 无关PR被外部抖动挂 → 用 paths 过滤缓解 |

## 前置工作

- [x] 真机 HONOR MAA-AN00 在线（xian-m4 adb devices 确认）
- [x] SSOT 代码可达（xian-m4 ~/ab-test/ 三件套）
- [x] toapis 凭据在 ~/.credentials/toapis.env；CI 需 gh secret set TOAPIS_API_KEY
- [x] quality-tests CI job 存在（packages/quality 变更时 npm test = vitest run）
- [x] 统一棘轮台账机制存在（scripts/ratchet-guard.mjs + ratchet-registry.json）

## 验收标准（Final E2E）

- [ ] 四条用例先红后绿（TDD commit 顺序），进 quality-tests job 永久跑
- [ ] 金标集 ≥10 张真机截图 + manifest，进 repo
- [ ] 本地真跑 goldset-eval.mjs：判定器通过率 ≥ 阈值（真 LLM 调用，非 mock）
- [ ] ratchet-guard 新指标 proven-to-fire：手动把阈值调低跑一次守卫，亲眼看它红
- [ ] CI 全绿 + PR merged

## 不包含

- 真机 nightly（registry 坐标新鲜度、端到端成功率统计）→ 后续件
- registry 运行时回写通道（registry 是数据不走 PR）→ 后续件
- Realme 换机型验证
