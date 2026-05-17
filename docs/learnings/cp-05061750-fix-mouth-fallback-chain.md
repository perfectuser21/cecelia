# Learning: cp-05061750-fix-mouth-fallback-chain

## 事件

mouth 的 fallback 链全部失效——primary anthropic bridge 8s timeout，fallback codex token 401，fallback anthropic-api 余额 0。结果 mouth 整体几乎必失败，cecelia-run 熔断累积 526 次失败。

## 根本原因

**配置静态依赖动态状态**：fallback 配置在 model_profile 里写死了 codex 和 anthropic-api 两个 provider，但这两个 provider 的实际可用性依赖外部凭据（refresh token / 余额），凭据失效后没有任何机制更新配置——配置永远指向失效路径。

更深层：**没有 fallback 链健康监测**。理论上每个 fallback 候选应该有"最近成功率"指标，但当前 fallback 选择是**纯静态优先级**，不感知失败率。

## 下次预防

- [ ] **Fallback 配置应该是动态优先级**：基于最近成功率自动重排候选顺序，把高失败率的 provider 降级到最后或暂时移出
- [ ] **凭据健康监测必须主动**（属于 MJ4 自主神经的加厚 thin feature）：每小时探测每个 provider 的可用性，失败率 >50% 自动 alert
- [ ] **migration 改 DB 配置时必须有 rollback 路径**：本 migration 没有 DOWN 部分，如果误改要从 git 历史还原。后续 migration 应该写 reversible 形式
- [ ] **加厚先减肥**：本 PR 0→thin（首次显式收口 mouth fallback）；后续若改 llm-caller.js implicit fallback 逻辑，必须先删 line 224-235（anthropic-api 直连兜底）再写新逻辑
- [ ] **Walking Skeleton 视角**：本次属于 MJ4 Cecelia 自主神经的加厚——LLM 凭据健康闭环。当前是 0→thin，未来 medium 应该接入 dispatcher 决策（凭据降级时自动切换到健康 provider）
