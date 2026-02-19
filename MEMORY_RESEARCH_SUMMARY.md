# Cecelia Core Memory System - Complete Research Summary

## 1. Memory Service Architecture

### File: `brain/src/services/memory-service.js`

The Memory Service provides a **3-layer recursive search pattern**:

#### Key Methods:

**1. `search(query, options = {})`** - Summary Layer
- Returns: `{ id, level, title, similarity, preview }`
- Parameters:
  - `query` (string): Search term
  - `topK` (number, default: 5): Number of results
  - `mode` (string, 'summary' | 'full'): Return format
- Calls: `similarity.searchWithVectors()`
- Generates 100-char preview from description

**2. `getDetail(id)`** - Detail Layer
- Looks up entity across three tables in order:
  1. Tasks table
  2. Projects table  
  3. Goals table
- Returns complete object: `{ id, level, title, description, status, metadata, created_at }`
- Throws error if not found

**3. `searchRelated(baseId, options = {})`** - Related Layer
- Finds similar entities to a base task/project/goal
- Parameters:
  - `baseId` (string): Entity UUID
  - `topK` (number, default: 5): Results to return
  - `excludeSelf` (boolean, default: true): Exclude base entity
- Process:
  1. Gets base entity via `getDetail(baseId)`
  2. Uses base entity title for similarity search
  3. Filters out base ID (excludeSelf=true)
  4. Returns summary format

### Helper Methods:

**`_generatePreview(description)`**
- Removes Markdown: `#`, `**`
- Replaces newlines with spaces
- Truncates to 100 characters + "..."

**`_formatDetail(row)`**
- Standardizes entity data format
- Handles nullable metadata

---

## 2. Memory Routes (API Layer)

### File: `brain/src/routes/memory.js`

**Endpoints:**

```
POST /api/brain/memory/search
  Body: { query, topK, mode }
  Returns: { matches: [...] }

GET /api/brain/memory/detail/:id
  Params: id (UUID)
  Returns: Complete entity object

POST /api/brain/memory/search-related
  Body: { base_id, topK, exclude_self }
  Returns: { matches: [...] }
```

---

## 3. Similarity Service (Core Search Engine)

### File: `brain/src/similarity.js`

**Two-Phase Implementation:**
- **Phase 0**: Jaccard similarity (token intersection/union)
- **Phase 1**: OpenAI embeddings + pgvector (semantic search)

### Main Search Methods:

#### `searchSimilar(query, topK = 5, filters = {})`
- **Pure Jaccard Similarity Fallback**
- Calculates score = Jaccard + KeywordBoost + StatusPenalty
- Edge cases handled (empty tokens)
- KeywordBoost capped at 0.3 (30%)
- Status penalty: -0.1 for completed tasks

#### `searchWithVectors(query, options = {})`
- **Hybrid Search: 70% Vector + 30% Jaccard**
- Parameters:
  - `topK` (default: 5)
  - `hybridWeight` (default: 0.7): Vector vs Jaccard ratio
  - `fallbackToJaccard` (default: true): Fallback if OpenAI fails
  - Filters: `repo`, `repos[]`, `status`, `dateFrom`, `dateTo`
- Process:
  1. Generate query embedding via OpenAI
  2. Perform vector search on pgvector
  3. Perform Jaccard search (for hybrid)
  4. Merge results with weighted scoring
  5. Return top K

#### `vectorSearch(queryEmbedding, filters = {})`
- Uses pgvector HNSW index
- Cosine similarity distance
- Supports filtering by repo, status, date range
- Returns top K candidates

### Helper Methods:

**`tokenize(text)`**
- Splits text into lowercase words
- Keeps Chinese characters (`\u4e00-\u9fa5`)
- Removes special chars
- Filters words < 2 chars

**`extractKeywords(text)`**
- Removes stopwords (Chinese & English)
- Returns high-value tokens

**`calculateScore(query, entity)`**
- Combines:
  - Jaccard similarity
  - Keyword boost (max 0.3)
  - Status penalty
- Result capped at 1.0

**`mergeResults(vectorResults, jaccardResults, weight)`**
- Hybrid scoring: `weight * vectorScore + (1-weight) * jaccardScore`
- Deduplicates results

---

## 4. Database Schema

### Migration 028: Vector Embeddings

```sql
-- Tables with embeddings (vector(1536)):
ALTER TABLE tasks ADD COLUMN embedding vector(1536);
ALTER TABLE projects ADD COLUMN embedding vector(1536);
ALTER TABLE goals ADD COLUMN embedding vector(1536);

-- HNSW indexes (cosine similarity):
CREATE INDEX tasks_embedding_idx ON tasks 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### Migration 031: Capabilities Embeddings

```sql
ALTER TABLE capabilities ADD COLUMN embedding vector(1536);

CREATE INDEX capabilities_embedding_idx ON capabilities
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### Memory-Related Base Tables

```sql
CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  title varchar(255),
  description text,
  status varchar(50),      -- Used for filtering
  priority varchar(10),
  metadata jsonb,          -- May contain 'repo'
  created_at timestamp,
  embedding vector(1536)   -- OpenAI embedding
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name varchar(255),
  description text,
  status varchar(50),
  embedding vector(1536)
);

CREATE TABLE goals (
  id uuid PRIMARY KEY,
  title varchar(255),
  description text,
  status varchar(50),
  embedding vector(1536)
);

CREATE TABLE capabilities (
  id uuid PRIMARY KEY,
  title varchar(255),
  description text,
  embedding vector(1536)
);
```

---

## 5. Thalamus Tests (Event Router/Decision Router)

### File: `brain/src/__tests__/thalamus.test.js`

#### Test Patterns:

**Decision Structure:**
```javascript
const decision = {
  level: 0|1|2,              // Decision tier
  actions: [                 // Array of actions to execute
    { 
      type: 'action_name',   // Must be in ACTION_WHITELIST
      params: { ... }        // Action-specific parameters
    }
  ],
  rationale: 'string',       // Why this decision
  confidence: 0.0-1.0,       // Decision confidence
  safety: false              // Safety override flag
};
```

**Action Validation Tests:**
```javascript
// Valid action
{ type: 'dispatch_task', params: {} }
{ type: 'create_task', params: {} }
{ type: 'cancel_task', params: {} }

// Dangerous action (requires safety flag)
{ type: 'request_human_review', params: {} }

// All must be in ACTION_WHITELIST
```

**Event Types:**
```javascript
EVENT_TYPES = {
  HEARTBEAT: 'heartbeat',
  TICK: 'tick',
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
  USER_MESSAGE: 'user_message',
  OKR_CREATED: 'okr_created'
};
```

**Quick Route Examples (Level 0 - No LLM needed):**
```javascript
// Heartbeat → no_action
{ type: 'heartbeat' } → level: 0, actions: [{ type: 'no_action' }]

// Normal tick → fallback_to_tick
{ type: 'tick', has_anomaly: false } → level: 0, actions: [{ type: 'fallback_to_tick' }]

// Task completed (no issues) → dispatch_task
{ type: 'task_completed', has_issues: false } → level: 0, actions: [{ type: 'dispatch_task' }]

// These need LLM analysis (return null)
{ type: 'tick', has_anomaly: true } → null (needs Sonnet)
{ type: 'task_failed' } → null (needs analysis)
```

---

## 6. Decision Executor - Action Handlers

### File: `brain/src/decision-executor.js`

#### Brain Core Actions (Thalamus Level)

**1. `dispatch_task(params, context)`**
```javascript
// Calls existing tick dispatch logic
params: { trigger: 'string' } // Optional trigger source
returns: { success: boolean, dispatched: result }
```

**2. `create_task(params, context)`**
```javascript
params: {
  title: string,              // Required
  description: string,        // Optional
  task_type: string,          // Default: 'dev'
  priority: string,           // Default: 'P1'
  project_id: uuid,           // Optional
  goal_id: uuid,              // Optional
  payload: object             // Optional metadata
}
returns: { success: boolean, task_id: uuid }
```

**3. `cancel_task(params, context)`**
```javascript
params: { task_id: uuid }
returns: { success: boolean }
// Updates task status to 'cancelled'
```

**4. `retry_task(params, context)`**
```javascript
params: { task_id: uuid }
returns: { success: boolean }
// Updates task status to 'queued'
```

**5. `reprioritize_task(params, context)`**
```javascript
params: { task_id: uuid, priority: string }
returns: { success: boolean }
```

**6. `create_okr(params, context)`**
```javascript
params: {
  title: string,
  description: string,        // Optional
  type: string,               // Default: 'global_okr'
  priority: string,           // Default: 'P1'
  project_id: uuid            // Optional
}
returns: { success: boolean, goal_id: uuid }
```

**7. `update_okr_progress(params, context)`**
```javascript
params: { goal_id: uuid, progress: number }
returns: { success: boolean }
```

**8. `assign_to_autumnrice(params, context)`**
```javascript
params: {
  okr_title: string,
  okr_description: string,
  goal_id: uuid
}
returns: { success: boolean, task_id: uuid }
// Creates 'dev' task with decomposition payload
```

**9. `notify_user(params, context)`**
```javascript
params: { message: string }
// Writes to cecelia_events table
returns: { success: boolean }
```

**10. `log_event(params, context)`**
```javascript
params: {
  event_type: string,         // Default: 'log'
  data: object                // Event data
}
returns: { success: boolean }
```

**11. `escalate_to_brain(params, context)`**
```javascript
params: {
  reason: string,
  context: string,            // Optional detailed context
  original_event: object      // Optional event data
}
returns: { success: boolean, task_id: uuid }
// Creates 'talk' type task for Brain LLM
```

**12. `request_human_review(params, context)` [DANGEROUS]**
```javascript
params: { reason: string }
// Writes human review request to cecelia_events
returns: { success: boolean, requires_human: true }
```

**13. `analyze_failure(params, context)`**
```javascript
params: {
  task_title: string,
  task_id: uuid,
  error: string,
  retry_count: number         // Optional
}
returns: { success: boolean, analysis_task_id: uuid }
// Creates 'research' type task
```

**14. `predict_progress(params, context)`**
```javascript
params: { goal_id: uuid }
returns: { success: boolean, prediction: 'not_implemented' }
// TODO: Placeholder for future implementation
```

**15. `no_action(params, context)`**
```javascript
params: {} (ignored)
returns: { success: true, action: 'none' }
```

**16. `fallback_to_tick(params, context)`**
```javascript
params: {} (ignored)
returns: { success: true, fallback: true }
// Signal to revert to pure code-based Tick logic
```

---

#### Cortex Actions (Deep Analysis)

**17. `adjust_strategy(params, context)` [DANGEROUS]**

**Whitelist:**
```javascript
dispatch_interval_ms:        3,000 - 60,000 ms (default: 5,000)
max_concurrent_tasks:        1 - 10 (default: 3)
task_timeout_ms:             60,000 - 1,800,000 ms (default: 600,000)
failure_rate_threshold:      0.2 - 0.5 (default: 0.3)
retry_delay_ms:              5,000 - 120,000 ms (default: 30,000)
```

**Forbidden Parameters:**
- `quarantine_threshold`
- `alertness_thresholds`
- `dangerous_action_list`
- `action_whitelist`
- `security_level`

**Safety Constraints:**
- Max change: ±20% from current value
- Only numeric parameters
- Value validation by min/max bounds
- Records to `brain_config` table
- Logs changes to `cecelia_events`

```javascript
params: {
  key: string,
  new_value: number,
  reason: string              // Why adjusting
}
returns: { 
  success: boolean,
  key: string,
  previous_value: number,
  new_value: number,
  error: string (if failed)
}
```

**18. `record_learning(params, context)`**
```javascript
params: {
  learning: string,
  category: string,           // Optional, default: 'general'
  event_context: object       // Optional
}
returns: { success: boolean }
// Writes to cecelia_events with type: 'learning'
```

**19. `create_rca_report(params, context)`**
```javascript
params: {
  task_id: uuid,
  root_cause: string,
  contributing_factors: array[string],
  recommended_actions: array[string]
}
returns: { success: boolean, task_id: uuid }
// Inserts into decision_log table
```

---

#### Dangerous Actions Management

**Dangerous Actions:** Actions marked `dangerous: true` in whitelist
- Examples: `request_human_review`
- Process: Enqueued to `pending_actions` table instead of immediate execution
- Expiration: 24 hours by default

**Functions:**

**`enqueueDangerousAction(action, context, client)`**
```javascript
// Inserts into pending_actions with status: 'pending_approval'
// expires_at: NOW() + 24 HOURS
returns: { 
  success: boolean,
  pending_approval: true,
  pending_action_id: uuid
}
```

**`approvePendingAction(actionId, reviewer = 'unknown')`**
```javascript
// Transaction:
// 1. Lock row FOR UPDATE
// 2. Validate status & expiration
// 3. Execute handler
// 4. Update pending_actions: status = 'approved'
returns: { 
  success: boolean,
  execution_result: result
}
```

**`rejectPendingAction(actionId, reviewer, reason)`**
```javascript
// Update pending_actions: status = 'rejected'
returns: { success: boolean }
```

**`getPendingActions()`**
```javascript
// Fetch all pending_approval actions (not expired)
// Ordered by created_at ASC
returns: array of pending action records
```

---

## 7. Embedding Service

### File: `brain/src/embedding-service.js`

**Purpose:** Async background generation of task embeddings

**Function: `generateTaskEmbeddingAsync(taskId, title, description)`**

```javascript
// Fire-and-forget pattern - never blocks
// - No-op if OPENAI_API_KEY not set
// - Silently fails on API error (doesn't impact main flow)
// - Text limited to 4000 chars
// - Stores as pgvector in tasks table

params:
  taskId: uuid
  title: string
  description: string | null

// Uses: SimilarityService.generateEmbedding()
// Updates: tasks.embedding (vector(1536))
```

---

## 8. Memory Test Patterns

### File: `brain/src/__tests__/services/memory-service.test.js`

**Test Structure:**

```javascript
describe('MemoryService', () => {
  beforeEach(() => {
    // Mock SimilarityService
    mockSimilarity = { searchWithVectors: vi.fn() };
    service = new MemoryService(pool);
  });

  it('返回 summary 格式', async () => {
    // Mock similarity results
    mockSimilarity.searchWithVectors.mockResolvedValue({
      matches: [{
        id: 'abc-123',
        level: 'task',
        title: 'feat(auth): ...',
        score: 0.32,
        description: '## Summary\n- ...'
      }]
    });

    // Call & Assert
    const result = await service.search('query', { topK: 5, mode: 'summary' });
    
    // Should have: id, level, title, similarity, preview
    expect(result.matches[0]).toHaveProperty('similarity', 0.32);
    expect(result.matches[0]).toHaveProperty('preview');
    expect(result.matches[0].preview).toContain('...');
  });
});
```

**Key Test Assertions:**
- Summary format: 5 fields only
- Full format: all fields from raw result
- Preview: truncated, Markdown removed, newlines → spaces
- Query passed correctly to similarity service
- Entity not found throws error
- Related search excludes self

---

## 9. Complete Data Flow Example

```
User Query: "用户登录验证"
    ↓
POST /api/brain/memory/search { query, topK: 5, mode: 'summary' }
    ↓
MemoryService.search(query, { topK: 5, mode: 'summary' })
    ↓
SimilarityService.searchWithVectors(query, { topK: 5 })
    ↓
    ├─ generateEmbedding(query)                [OpenAI API]
    ├─ vectorSearch(embedding, filters)       [pgvector HNSW]
    ├─ searchSimilar(query, topK*3)           [Jaccard fallback]
    └─ mergeResults(vectorResults, jaccardResults, weight=0.7)
    ↓
MemoryService formats results (summary mode):
    map to { id, level, title, similarity, preview }
    ↓
Response: { matches: [{ id, level, title, similarity, preview }, ...] }
```

---

## 10. Key Configurations

**Vector Settings:**
- Dimension: 1536 (OpenAI text-embedding-3-small)
- Index Type: HNSW (Hierarchical Navigable Small World)
- Distance Metric: Cosine Similarity
- Index Parameters:
  - m = 16 (connections per layer)
  - ef_construction = 64 (candidate list size)

**Search Parameters:**
- Hybrid Weight: 70% vector, 30% Jaccard
- Jaccard Score Threshold: 0.3 (filter out low scores)
- Keyword Boost: Max 0.3 (30%)
- Status Penalty: -0.1 (for completed tasks)
- Result Limit: topK (default 5)

**Fallback Strategy:**
- If OpenAI API fails → Fallback to pure Jaccard
- If no embedding exists → Use Jaccard only
- No errors propagated to user

---

## 11. Summary Table

| Component | File | Purpose | Key Methods |
|-----------|------|---------|------------|
| MemoryService | memory-service.js | Search API layer | search, getDetail, searchRelated |
| SimilarityService | similarity.js | Hybrid search engine | searchWithVectors, vectorSearch, searchSimilar |
| EmbeddingService | embedding-service.js | Async embedding generation | generateTaskEmbeddingAsync |
| Memory Routes | routes/memory.js | HTTP endpoints | /search, /detail/:id, /search-related |
| DecisionExecutor | decision-executor.js | Action execution | 19+ action handlers |
| Thalamus | thalamus.js | Decision validation | validateDecision, quickRoute |

