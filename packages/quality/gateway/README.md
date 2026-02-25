# Gateway - Unified Input Gateway

## Overview

Gateway is the "thalamus" of the Cecelia system - the single point where all inputs converge.

## Architecture

```
All Input Sources → Gateway → Queue → Worker → Evidence
    ↓
CloudCode, Notion, n8n, Webhook, CLI
```

## Usage

### Enqueue Task (JSON)

```bash
# From JSON string
./gateway/gateway.sh enqueue '{"taskId":"uuid","source":"cloudcode","intent":"runQA","priority":"P0","payload":{}}'

# From stdin
echo '{"taskId":"uuid",...}' | ./gateway/gateway.sh enqueue
```

### Enqueue Task (CLI mode)

```bash
./gateway/gateway.sh add <source> <intent> [priority] [payload]

# Example
./gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-quality"}'
```

### Check Queue Status

```bash
./gateway/gateway.sh status
```

## Task Schema

```json
{
  "taskId": "uuid",
  "source": "cloudcode|notion|chat|n8n|webhook|heartbeat",
  "intent": "runQA|fixBug|refactor|review|summarize|optimizeSelf",
  "priority": "P0|P1|P2",
  "payload": {...},
  "createdAt": "2026-01-27T14:00:00Z"
}
```

See `task-schema.json` for full JSON Schema.

## Integration Examples

### From Claude Code

```bash
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-workspace"}'
```

### From n8n Workflow

```javascript
// HTTP POST to gateway.sh via exec node
const task = {
  taskId: uuid(),
  source: "n8n",
  intent: "runQA",
  priority: "P1",
  payload: { project: "cecelia-workspace" }
};

exec(`echo '${JSON.stringify(task)}' | /path/to/gateway.sh enqueue`);
```

### From Webhook

```bash
curl -X POST http://localhost:5679/webhook/cecelia-gateway \
  -H "Content-Type: application/json" \
  -d '{"source":"webhook","intent":"runQA","priority":"P0","payload":{}}'
```

## Files

- `gateway.sh` - Main script
- `task-schema.json` - JSON Schema for task validation
- `README.md` - This file
