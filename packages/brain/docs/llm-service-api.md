# Brain LLM Service HTTP API

对外暴露 Cecelia Brain 内部的 `callLLM` 能力，供 zenithjoy pipeline-worker、creator 等内部系统统一调用 LLM（写文案、审图、生成结构化输出）。

- **基础路径**：`/api/brain/llm-service`
- **默认端口**：`5221`（Cecelia Brain）
- **鉴权**：`internalAuth` 中间件（Bearer token 或 X-Internal-Token；未设 env 时 dev 放行）

## 端点

### POST /generate

调用 LLM 生成文本。

**请求 Headers**

| Header | 说明 |
|---|---|
| `Content-Type: application/json` | 必填 |
| `Authorization: Bearer <token>` | 二选一（当 `CECELIA_INTERNAL_TOKEN` env 设置时必填） |
| `X-Internal-Token: <token>` | 二选一 |

**请求 Body**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `tier` | string | 是 | — | Brain 层 agent，见下方「tier 列表」 |
| `prompt` | string | 是 | — | 完整 prompt；最长 200000 字符 |
| `max_tokens` | number | 否 | 2048 | 最大输出 token；硬上限 16384 |
| `timeout` | number | 否 | 180 | 单次调用超时（秒）；硬上限 600 |
| `format` | `"text"` \| `"json"` | 否 | `"text"` | `"json"` 时会自动在 prompt 末尾追加 JSON 输出 hint |

**tier 列表**（对应 `model-profile.config.<tier>`）

| tier | 典型用途 |
|---|---|
| `thalamus` | 丘脑：轻量编排 / 文案生成（默认 Haiku） |
| `cortex` | 皮层：深度推理 / 复杂分析（默认 Sonnet） |
| `mouth` | 对话嘴巴：面向用户的自然语言响应 |
| `reflection` | 反思 |
| `narrative` | 叙事 / 日记 |
| `memory` | 记忆整理 |
| `fact_extractor` | 事实抽取 |

实际使用的 model / provider 由 active model-profile 决定，调用方无需关心。

**成功响应（HTTP 200）**

```json
{
  "success": true,
  "data": {
    "text": "生成的文本...",
    "content": "生成的文本...",
    "model": "claude-haiku-4-5-20251001",
    "provider": "anthropic-api",
    "tier": "thalamus",
    "elapsed_ms": 1234,
    "tokens_used": { "input": null, "output": null },
    "account_id": null,
    "attempted_fallback": false
  },
  "error": null
}
```

- `text` 与 `content` 字段内容一致（后者兼容 `copywriting.py` 等调用方）。
- `tokens_used` / `account_id` 为占位字段（`callLLM` 当前未返回，后续扩展时会填充）。

**错误响应**

```json
{
  "success": false,
  "data": null,
  "error": { "code": "...", "message": "..." }
}
```

| HTTP | code | 触发条件 |
|---|---|---|
| 400 | `INVALID_TIER` | 缺失或非法 tier |
| 400 | `INVALID_PROMPT` | 空 prompt |
| 400 | `PROMPT_TOO_LARGE` | prompt 长度 > 200000 字符 |
| 400 | `INVALID_MAX_TOKENS` | 非正数或 > 16384 |
| 400 | `INVALID_TIMEOUT` | 非正数或 > 600 秒 |
| 400 | `INVALID_FORMAT` | 不是 `text` / `json` |
| 401 | `UNAUTHORIZED` | 缺失或错误的 internal token |
| 500 | `LLM_TIMEOUT` | `callLLM` 超时（`err.degraded=true` 或 message 含 timeout） |
| 500 | `LLM_AUTH_FAILED` | 上游返回 401/403（API key 失效等） |
| 500 | `LLM_QUOTA_EXCEEDED` | 429 / spending cap / 额度相关 |
| 500 | `LLM_PROMPT_TOO_LONG` | 413 / 上游 context length 超限 |
| 500 | `LLM_CALL_FAILED` | 其他未分类的 LLM 调用失败 |

## curl 示例

### 最小请求（dev 模式，无鉴权）

```bash
curl -X POST http://localhost:5221/api/brain/llm-service/generate \
  -H 'Content-Type: application/json' \
  -d '{"tier":"thalamus","prompt":"用一句话打招呼"}'
```

### 指定上限与格式

```bash
curl -X POST http://localhost:5221/api/brain/llm-service/generate \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN' \
  -d '{
    "tier": "cortex",
    "prompt": "分析 X 并输出结构化 JSON {summary, bullets[]}",
    "max_tokens": 4096,
    "timeout": 120,
    "format": "json"
  }'
```

## 部署

1. （可选但建议）生成并保存 internal token
   ```bash
   openssl rand -hex 32 > ~/.credentials/cecelia-internal-token
   chmod 600 ~/.credentials/cecelia-internal-token
   ```
   同步存入 1Password（CS Vault → "Cecelia Internal LLM Token"），并把 token 注入 cecelia brain plist 的 `CECELIA_INTERNAL_TOKEN` env。

2. 重启 Cecelia Brain
   ```bash
   launchctl kickstart -k gui/501/com.cecelia.brain
   ```

3. 验证
   ```bash
   curl -sS -X POST http://localhost:5221/api/brain/llm-service/generate \
     -H 'Content-Type: application/json' \
     -d '{"tier":"thalamus","prompt":"say hi in one sentence"}'
   ```

4. 重启依赖方
   ```bash
   launchctl kickstart -k gui/501/com.zenithjoy.pipeline-worker
   ```

## 内部实现说明

- `routes/llm-service.js` 做参数校验 + 错误分类 + 响应包装。
- 真正调用依旧走 `packages/brain/src/llm-caller.js` 的 `callLLM(tier, prompt, options)`，复用 model-profile / account-usage / fallback cascade / langfuse reporter。
- 中间件 `middleware/internal-auth.js` 挂在 `/api/brain/llm-service` 前缀上，其他 `/api/brain/*` 不受影响。
