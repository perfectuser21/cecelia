# 关闭 Codex OAuth 掉线时的 API Key 计费 Fallback

## 背景

`packages/brain/src/llm-caller.js` 的 `callCodexHeadless()` 在两个 Codex OAuth team 账号（team1/team2）都不可用时，会静默切换成用 `OPENAI_API_KEY` 直接按量计费调用 Codex CLI，且只有一条 `console.warn`，没有任何告警机制。这个 fallback 在 2026-09-02 排查 AFFiNE AI 故障时被发现：一个原本专供 AFFiNE 使用的 OpenAI Service Account Key 曾在某段 Codex OAuth 账号掉线期间被这个 fallback 烧掉约 24 美元（`gpt-5.6-sol`，cache writes 为主，符合 coding agent 大 system prompt 反复重写缓存的特征）。详见 memory `affine-ai-outage-openai-balance-and-codex-fallback.md`。

## 目标

彻底关闭这条"静默按量计费"路径，OAuth 账号全部不可用时直接失败，交给上层已有的 provider fallback 机制处理，而不是背着人花钱。

## 方案

`callCodexHeadless()` 的 else 分支（当前：读 `getOpenAIKey()`，设置 `env.OPENAI_API_KEY`/`env.CODEX_API_KEY`，继续走 `spawn('codex', ...)`）改为直接 `throw`：

```js
} else {
  throw new Error(
    'Codex: 无可用 OAuth team 账号（team1/team2 全部掉线），已禁止 fallback 到 API Key 计费，请检查 codex 账号登录状态'
  );
}
```

不需要新增兜底逻辑——`callLLM()` 的 candidates 循环外层已经有"所有候选失败且无 anthropic 候选时，紧急兜底走 anthropic-api，再兜底走 anthropic bridge"的机制（`llm-caller.js` 197-223 行，早已存在），codex 抛错后会自动落到这条路径，不会导致调用方彻底失败。

## 影响范围

- 只改 `callCodexHeadless()` 的 else 分支，OAuth 账号可用时的正常路径完全不动
- 调用方（各处 `callLLM(agentId, prompt, {provider:'codex', ...})`）行为变化：OAuth 全掉线时不再花钱调用 Codex，而是自动降级到 Claude（anthropic-api/bridge）

## 测试

新增 regression test（`packages/brain/src/__tests__/llm-caller.test.js`）：
1. mock 掉两个 team 账号的 `auth.json` 读取（复用现有 `fs` mock 的默认"文件不存在"分支即可，无需改动）
2. mock `child_process.spawn`（新增，仅用于断言"没被调用"——现有测试文件从未 mock 过 `child_process`，因为此前没有测试覆盖过 codex provider 路径）
3. 在 `process.env.OPENAI_API_KEY` 设置一个哨兵值的前提下调用 `callLLM(..., {provider:'codex', model:'codex/...'})`
4. 断言：`spawn` 从未被调用；最终结果通过 anthropic-api 紧急兜底返回（`result.provider === 'anthropic-api'`）；抛出的错误消息匹配"无可用 OAuth team 账号"

这个测试在**修复前跑会失败**（当前代码会把哨兵 API Key 塞进 env 并调用真实 `spawn('codex', ...)`，测试里 spawn 是 mock 但会被调用到，断言"从未被调用"会失败），修复后应变绿。
