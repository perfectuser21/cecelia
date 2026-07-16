# 步骤：轻量 Evaluator（light-evaluator）

## 角色

push 前自动扫描当前 sprint 的 DoD 文件，提取所有 `[BEHAVIOR]` 条目的 `Test:` 命令，逐条真执行，结果写 `verify-record.json`。

**决策挂靠**：145014a4③「改行为必有 evaluator 真跑复核」

---

## 豁免规则

以下情况直接豁免，evaluator 步骤 exit 0，push **不**被阻断：

1. sprint 目录下所有 DoD 文件（`contract-dod*.md`）均不含 `[BEHAVIOR]` 条目
2. sprint 目录不存在任何 DoD 文件

豁免时 `verify-record.json` 必须写入：

```json
{
  "skipped": true,
  "reason": "no [BEHAVIOR] entries",
  "files": ["<扫描的文件列表>"],
  "timestamp": "<ISO8601>"
}
```

---

## 执行流程

```
扫描 sprint-dir/contract-dod*.md
  ├── 无 [BEHAVIOR] → 写 skipped 记录 → exit 0
  └── 有 [BEHAVIOR] →
        逐条提取 Test: manual:bash -c "..." 命令
        逐条执行（超时 60s）
        记录 exit_code + 尾 5 行输出
        ├── 全部 exit_code=0 → 写 verify-record.json → exit 0
        └── 任一 exit_code≠0 → 写 verify-record.json（含失败条目）→ exit 1（阻断 push）
```

---

## verify-record.json 格式规范（A-01）

### 正常执行记录（每条 BEHAVIOR 一个 entry）

```json
{
  "sprint_dir": "<sprint 路径>",
  "timestamp": "<ISO8601>",
  "overall": "PASS" | "FAIL",
  "entries": [
    {
      "id": "B-01",
      "cmd": "<执行的命令>",
      "exit_code": 0,
      "tail5": ["<最后5行输出>"],
      "timestamp": "<ISO8601>"
    }
  ]
}
```

字段说明：
- `cmd`：实际执行的 bash 命令（来自 `Test: manual:bash -c "..."` 行）
- `exit_code`：命令退出码，0=PASS，非0=FAIL
- `tail5`：命令 stdout+stderr 合并输出的最后 5 行（数组）
- `timestamp`：该条命令的执行时间（ISO8601）

### 豁免记录

```json
{
  "skipped": true,
  "reason": "no [BEHAVIOR] entries",
  "files": ["contract-dod.md"],
  "timestamp": "<ISO8601>"
}
```

字段说明：
- `skipped`：布尔值，true 表示豁免
- `reason`：豁免原因（固定值：`"no [BEHAVIOR] entries"`）
- `files`：扫描过的文件名列表
- `timestamp`：豁免时间（ISO8601）

---

## INV 约束说明

| 约束 | 说明 |
|------|------|
| INV-01 | 无 [BEHAVIOR] 条目必须豁免并留痕，不得阻断 push |
| INV-02 | 不 spawn 独立 session，不调 judge，只原地真跑 |
| INV-04 | 任一命令 exit_code ≠ 0，整步 FAIL，阻断 push（evaluator exit 1） |
| INV-06 | 版本 bump 必须 5 文件同步（package.json、CHANGELOG.md、feature-registry.yml、SKILL.md frontmatter、VERSION） |

---

## 调用方式

```bash
# 正常调用（扫描指定 sprint 目录）
node packages/engine/scripts/devgate/light-evaluator.cjs --sprint-dir <sprint-dir>

# 干运行（豁免路径验证，用无 BEHAVIOR 的目录测试）
node packages/engine/scripts/devgate/light-evaluator.cjs --sprint-dir <sprint-dir> --dry-run-no-behavior
```

---

## 输出示例

**豁免路径：**
```
[light-evaluator] 扫描 sprint 目录: sprints/07161830-dev-ab-light-evaluator
[light-evaluator] 未发现 [BEHAVIOR] 条目 → skipped（豁免）
[light-evaluator] 写 verify-record.json → sprints/.../verify-record.json
[light-evaluator] exit 0
```

**PASS 路径：**
```
[light-evaluator] 发现 3 条 [BEHAVIOR] 条目
[light-evaluator] B-01 ... PASS (exit_code=0)
[light-evaluator] B-02 ... PASS (exit_code=0)
[light-evaluator] B-03 ... PASS (exit_code=0)
[light-evaluator] 全部通过 → verify-record.json 已写
[light-evaluator] exit 0
```

**FAIL 路径：**
```
[light-evaluator] B-02 ... FAIL (exit_code=1)
  尾5行: ...
[light-evaluator] 有失败条目 → push 被阻断
[light-evaluator] exit 1
```
