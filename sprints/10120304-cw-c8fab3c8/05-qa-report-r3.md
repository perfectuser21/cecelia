---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7", "02-spec.md#Q-8", "02-spec.md#Q-9"]
---
# QA 报告（第 3 轮，有头接续）

执行者：Codex（独立于本次 cast 修复者）；跟进任务：90973445-0946-4b36-8440-0d70c358a4d2。
验收代码：23edec0ac97bdd5641c9f3a5ebf80cc9fed3746d；预览： http://localhost:5301 。
只按 01/02 及两份 commander 附录验收，不采信开发报告的成功结论。
本轮 API/PG 场景无 UI，无截图。API 请求只到 5301；PG 只连本机 /tmp socket 的 cecelia_scratch，全部变形回滚。没有访问生产来做 QA。
本轮是有头独立验收，不是 Claude/Codex 自动 runner 的重跑，不修改 qa-6319.json 或 runner passed 状态。

## 预览身份

```output
{
  "started_at": "2026-10-12T05:34:13Z",
  "status": 200,
  "git_sha": "23edec0ac97bdd5641c9f3a5ebf80cc9fed3746d",
  "runtime": {
    "isolated": true,
    "background_automation": false
  }
}
```

### T-1
对应: Q-1
verdict: PASS
```command
python3 sprints/10120304-cw-c8fab3c8/qa-r3/api.py
```
完整请求及响应见 qa-r3/api-evidence.json；本次逐项断言结果：
```output
[
  {
    "topic": "判定点[qa-c8fab3c8-r3-1791783253984290000-Q-1-ai#1]: 部署判定",
    "made_by": "ai",
    "post_codes": [
      201
    ],
    "success": [
      true
    ],
    "get_matches": [
      {
        "id": "266c4e21-aafe-443b-a2c3-f38379d4ecff",
        "category": "judgment",
        "made_by": "ai",
        "author": "coding-workflow"
      }
    ]
  }
]
```

### T-2
对应: Q-2
verdict: PASS
```command
python3 sprints/10120304-cw-c8fab3c8/qa-r3/api.py
```
完整请求及响应见 qa-r3/api-evidence.json；本次逐项断言结果：
```output
[
  {
    "topic": "判定点[qa-c8fab3c8-r3-1791783253984290000-Q-2-system#1]: 部署判定",
    "made_by": "system",
    "post_codes": [
      201
    ],
    "success": [
      true
    ],
    "get_matches": [
      {
        "id": "d041a3ea-4360-436c-961e-e2d8eb3c4448",
        "category": "judgment",
        "made_by": "system",
        "author": "coding-workflow"
      }
    ]
  },
  {
    "topic": "判定点[qa-c8fab3c8-r3-1791783253984290000-Q-2-user#1]: 部署判定",
    "made_by": "user",
    "post_codes": [
      201
    ],
    "success": [
      true
    ],
    "get_matches": [
      {
        "id": "9ed7ffd4-6db6-4f4f-afd0-cf96480616fd",
        "category": "judgment",
        "made_by": "user",
        "author": "coding-workflow"
      }
    ]
  },
  {
    "topic": "判定点[qa-c8fab3c8-r3-1791783253984290000-Q-2-cecelia#1]: 部署判定",
    "made_by": "cecelia",
    "post_codes": [
      201
    ],
    "success": [
      true
    ],
    "get_matches": [
      {
        "id": "b6540b3b-d43e-4cc4-8700-9faff2bf302c",
        "category": "judgment",
        "made_by": "cecelia",
        "author": "coding-workflow"
      }
    ]
  }
]
```

### T-3
对应: Q-3
verdict: PASS
```command
python3 sprints/10120304-cw-c8fab3c8/qa-r3/api.py
```
完整请求及响应见 qa-r3/api-evidence.json；本次逐项断言结果：
```output
[
  {
    "topic": "判定点[qa-c8fab3c8-r3-1791783253984290000-Q-3-bogus_maker#1]: 部署判定",
    "made_by": "bogus_maker",
    "post_codes": [
      500
    ],
    "success": [
      false
    ],
    "get_matches": []
  }
]
```

### T-4
对应: Q-4
verdict: PASS
```command
python3 sprints/10120304-cw-c8fab3c8/qa-r3/api.py
```
完整请求及响应见 qa-r3/api-evidence.json；本次逐项断言结果：
```output
[
  {
    "topic": "判定点[qa-c8fab3c8-r3-1791783253984290000-Q-4-ai#1]: 部署判定",
    "made_by": "ai",
    "post_codes": [
      201,
      201
    ],
    "success": [
      true,
      true
    ],
    "get_matches": [
      {
        "id": "ead5acad-7a35-4996-8beb-9a9342e20d6a",
        "category": "judgment",
        "made_by": "ai",
        "author": "coding-workflow"
      },
      {
        "id": "28e57931-4660-475b-abe8-a2cd945da429",
        "category": "judgment",
        "made_by": "ai",
        "author": "coding-workflow"
      }
    ]
  }
]
```

### T-5
对应: Q-5
verdict: PASS
```command
node sprints/10120304-cw-c8fab3c8/qa-r3/scratch.mjs
```
```output
[
  {
    "name": "Q-5 迁移外加宽/幂等",
    "verdict": "PASS",
    "before": [
      {
        "conname": "qa_old_0",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY['user'::character varying, 'cecelia'::character varying, 'system'::character varying, 'qa_extra'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      }
    ],
    "after": [
      {
        "conname": "decisions_made_by_check",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'qa_extra'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      }
    ],
    "inserted_values": [
      "user",
      "cecelia",
      "system",
      "qa_extra",
      "ai"
    ],
    "rerun_identical": true,
    "schema_552_count": 1,
    "existing_rows_unchanged": true,
    "bogus_sqlstate": "23514"
  }
]
```

### T-6
对应: Q-6
verdict: PASS
```command
node sprints/10120304-cw-c8fab3c8/qa-r3/scratch.mjs
```
```output
[
  {
    "name": "Q-6 类型和默认值",
    "verdict": "PASS",
    "column": {
      "data_type": "character varying",
      "character_maximum_length": 20,
      "column_default": "'system'::character varying"
    },
    "default_insert": [
      {
        "made_by": "system"
      }
    ]
  }
]
```

### T-8
对应: Q-8
verdict: PASS
```command
node sprints/10120304-cw-c8fab3c8/qa-r3/scratch.mjs
```
```output
[
  {
    "name": "Q-8 空串及单引号",
    "verdict": "PASS",
    "before": [
      {
        "conname": "qa_old_0",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY['user'::character varying, 'cecelia'::character varying, 'system'::character varying, 'qa_extra'::character varying, ''::character varying, 'owner''x'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      }
    ],
    "after": [
      {
        "conname": "decisions_made_by_check",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY[''::character varying, 'ai'::character varying, 'cecelia'::character varying, 'owner''x'::character varying, 'qa_extra'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      }
    ],
    "inserted_values": [
      "user",
      "cecelia",
      "system",
      "qa_extra",
      "",
      "owner'x",
      "ai"
    ],
    "rerun_identical": true,
    "schema_552_count": 1,
    "existing_rows_unchanged": true,
    "bogus_sqlstate": "23514"
  }
]
```

### T-9
对应: Q-9
verdict: PASS
```command
node sprints/10120304-cw-c8fab3c8/qa-r3/scratch.mjs
```
```output
[
  {
    "name": "cast 显式 varchar→text 克隆原三值",
    "verdict": "PASS",
    "before": [
      {
        "conname": "qa_old_0",
        "def": "CHECK (((made_by)::text = ANY (ARRAY[('user'::character varying)::text, ('cecelia'::character varying)::text, ('system'::character varying)::text]))) NOT VALID",
        "convalidated": false
      }
    ],
    "after": [
      {
        "conname": "decisions_made_by_check",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      }
    ],
    "inserted_values": [
      "user",
      "cecelia",
      "system",
      "ai"
    ],
    "rerun_identical": true,
    "schema_552_count": 1,
    "existing_rows_unchanged": true,
    "bogus_sqlstate": "23514"
  },
  {
    "name": "cast 显式 varchar→text 含转义",
    "verdict": "PASS",
    "before": [
      {
        "conname": "qa_old_0",
        "def": "CHECK (((made_by)::text = ANY (ARRAY[('user'::character varying)::text, ('cecelia'::character varying)::text, ('system'::character varying)::text, ('owner''x'::character varying)::text]))) NOT VALID",
        "convalidated": false
      }
    ],
    "after": [
      {
        "conname": "decisions_made_by_check",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'owner''x'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      }
    ],
    "inserted_values": [
      "user",
      "cecelia",
      "system",
      "owner'x",
      "ai"
    ],
    "rerun_identical": true,
    "schema_552_count": 1,
    "existing_rows_unchanged": true,
    "bogus_sqlstate": "23514"
  }
]
```

### T-7
对应: Q-7′（commander 第 1 次替代条款）
verdict: PASS
未取得预览库只读连接，DP 未取得，未执行原 Q-7 的生产连接。严格按已批准替代判据：Q-1～Q-3 的本轮预览接口结果 + Q-5 的本机真实 PG 结果均 PASS。未将预览健康响应冒充 DP，也未声称核验生产当前状态。

### T-10
对应: S-1/S-1a/S-1b 失败语义、I-2
verdict: PASS
```command
node sprints/10120304-cw-c8fab3c8/qa-r3/scratch.mjs
```
```output
[
  {
    "name": "无 CHECK 恢复旧三值",
    "verdict": "PASS",
    "before": [],
    "after": [
      {
        "conname": "decisions_made_by_check",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      }
    ],
    "inserted_values": [
      "user",
      "cecelia",
      "system",
      "ai"
    ],
    "rerun_identical": true,
    "schema_552_count": 1,
    "existing_rows_unchanged": true,
    "bogus_sqlstate": "23514"
  },
  {
    "name": "改名及多 CHECK 并集",
    "verdict": "PASS",
    "before": [
      {
        "conname": "qa_old_0",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY['user'::character varying, 'cecelia'::character varying, 'system'::character varying, 'owner_y'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      },
      {
        "conname": "qa_old_1",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY['user'::character varying, 'owner_z'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      }
    ],
    "after": [
      {
        "conname": "decisions_made_by_check",
        "def": "CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'owner_y'::character varying, 'owner_z'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID",
        "convalidated": false
      }
    ],
    "inserted_values": [
      "user",
      "cecelia",
      "system",
      "owner_y",
      "owner_z",
      "ai"
    ],
    "rerun_identical": true,
    "schema_552_count": 1,
    "existing_rows_unchanged": true,
    "bogus_sqlstate": "23514"
  },
  {
    "name": "NULL 不静默收窄",
    "verdict": "PASS",
    "input": "made_by IN ('user','cecelia','system',NULL)",
    "error": {
      "code": "P0001",
      "message": "decisions 上约束 qa_old 无法解析出完整的 made_by 取值（回放不一致）：CHECK (((made_by)::text = ANY ((ARRAY['user'::character varying, 'cecelia'::character varying, 'system'::character varying, NULL::character varying])::text[]))) NOT VALID"
    },
    "unchanged_after_failed_migration": true,
    "schema_552_count": 0
  },
  {
    "name": "多列 CHECK 拒绝",
    "verdict": "PASS",
    "input": "made_by <> 'ai' OR category IS NOT NULL",
    "error": {
      "code": "P0001",
      "message": "decisions 上约束 qa_old 是涉及 made_by 的多列 CHECK，无法安全补 ai：CHECK ((((made_by)::text <> 'ai'::text) OR (category IS NOT NULL))) NOT VALID"
    },
    "unchanged_after_failed_migration": true,
    "schema_552_count": 0
  },
  {
    "name": "非白名单 CHECK 拒绝",
    "verdict": "PASS",
    "input": "length(made_by)>0",
    "error": {
      "code": "P0001",
      "message": "decisions 上约束 qa_old 无法解析出 made_by 取值：CHECK ((length((made_by)::text) > 0)) NOT VALID"
    },
    "unchanged_after_failed_migration": true,
    "schema_552_count": 0
  }
]
```

## 回滚、附加自动测试和边界

scratch 每个正例均核对迁移前后已有行数量和完整行序列摘要不变，并实际插入所有应保留取值。每个负例在迁移执行 SAVEPOINT 前记录约束、版本、数据；报错回滚后逐项相等、552 为零。最终整体 ROLLBACK，原约束、原版本和原数据摘要与开跑前完全一致（`rollback_verified=true`）。未提交任何 scratch 变形。

```command
cd packages/brain
DB_HOST=/tmp DB_NAME=cecelia_scratch DB_USER=administrator NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-552-decisions-made-by-ai.pg.integration.test.js
```
```output

 RUN  v1.6.1 /Users/administrator/worktrees/cecelia/canary-migration/packages/brain

 ✓ src/__tests__/integration/migration-552-decisions-made-by-ai.pg.integration.test.js  (11 tests) 60ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  13:35:57
   Duration  282ms (transform 22ms, setup 61ms, collect 19ms, tests 60ms, environment 0ms, prepare 36ms)

```
首次误用默认 vitest 配置时集成目录被排除，提示 No test files found；随后使用正式 integration 配置，11/11 真 PG 测试通过。无跳过测试冒充通过。

本轮没有重跑整个 migrate 启动器、CI 空库从零升级或生产部署后自检。生产克隆预览的 I-1 接口现已真实通过；I-2 由真实 scratch 变形与 Q-7′ 的授权替代路径覆盖。workflow 调用者是否将默认 system 改为 ai 不属本 PR 的改动范围。
API 留下本轮唯一 qa-c8fab3c8-r3 前缀的 6 条验收决策，仅在隔离预览中；bogus 没有落行。完整可复核请求/响应和迁移证据位于 qa-r3/。

本轮 QA 结论：PASS。后续使用既有 runJudge 第 3 轮对需求、合同、此报告和完整代码 diff 独立裁决。自动 runner 原状态须保持事实，合并仍应核必需 CI，再按有头接续证据路径由主代理判断。

## 独立裁判实际回执

既有 `runJudge` 第 3 轮已真实返回 PASS，模型 gpt-5.6-sol；I-1/I-2 均满足，blocking、unsatisfied、concerns 均为空，usage.total_tokens=22841。见 `06-judge-r3.md` 和 `qa-r3/judge-result.json`。这是人工接续 QA + 独立 judge PASS；原自动 Claude 流程没有完成，未将其改为 passed。
