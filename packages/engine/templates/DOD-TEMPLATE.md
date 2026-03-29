# DoD - <功能名>

> Definition of Done - 机器可判定的完成标准
>
> 与 PRD 配合使用，确保 AI Agent 和人工验收使用一致的标准
>
> **重要**: 每条验收项必须包含 `Test:` 字段，指定对应的测试

---

## 测试层级

### 项目能力（根据项目文件自动判断）

- **项目能力上限**: L<X>

### 本次任务

- **任务类型**: <文档修改/工具函数/API接口/用户界面/性能优化/安全相关>
- **任务需要层级**: L<Y>
- **实际执行**: L1 ~ L<max(X,Y)>

### 层级定义

| 层级 | 名称 | 包含检查 |
|------|------|----------|
| L1 | 静态分析 | typecheck, lint, format, shell syntax |
| L2 | 单元测试 | unit test |
| L3 | 集成测试 | integration test, API test |
| L4 | E2E测试 | playwright, cypress |
| L5 | 性能测试 | benchmark |
| L6 | 安全测试 | audit, dependency scan |

---

## 验收标准

### 功能验收

> **格式要求**: 每条验收项后必须跟 `Test:` 字段
> **Test 字段必须是可执行命令，返回明确 pass/fail（exit 0/1）**

- [ ] [ARTIFACT] 产出文件存在且包含预期内容
  Test: manual:node -e "const c=require('fs').readFileSync('path/to/file','utf8');if(!c.includes('expected'))process.exit(1)"
- [ ] [BEHAVIOR] 功能按预期运行（需服务 → 用自动化测试）
  Test: tests/path/to/behavior.test.ts
- [ ] [GATE] CI 全部通过
  Test: contract:<RCI_ID>

### Test 字段格式说明

| 格式 | 说明 | 示例 |
|------|------|------|
| `Test: tests/...` | 自动化测试文件路径 | `Test: tests/devgate/check-dod-mapping.test.ts` |
| `Test: contract:<ID>` | 引用 regression-contract.yaml 中的 RCI | `Test: contract:H1-001` |
| `Test: manual:node -e "..."` | 可执行 node 内联脚本（推荐，CI 兼容） | 见下方示例 |
| `Test: manual:curl -sf https://...` | 外部 HTTP 验证（非 localhost） | `Test: manual:curl -sf https://api.example.com/health` |
| `Test: manual:chrome: <断言描述>` | 视觉截图验证 | `Test: manual:chrome: verify sidebar is visible at /page` |

### ✅ 可执行 Test 写法示例（CI 兼容）

```
# 验证文件存在
Test: manual:node -e "require('fs').accessSync('path/to/file')"

# 验证文件包含特定内容
Test: manual:node -e "const c=require('fs').readFileSync('path/to/file','utf8');if(!c.includes('expectedStr'))process.exit(1)"

# 负向验证（确认某字符串已删除）
Test: manual:node -e "const c=require('fs').readFileSync('path/to/file','utf8');if(c.includes('oldStr'))process.exit(1)"

# 验证 JSON 文件结构
Test: manual:node -e "const d=JSON.parse(require('fs').readFileSync('path/to/file.json','utf8'));if(!d.key)process.exit(1)"

# 调用导出函数验证行为
Test: manual:node -e "const {fn}=require('./path/to/module.cjs');if(fn('input').result!=='expected')process.exit(1)"
```

### ❌ 禁止的 Test 写法

```
Test: manual:echo "done"           # 永远成功，无断言
Test: manual:ls src/               # 只列目录，不验证内容
Test: manual:cat file.txt          # 只读文件，不验证内容
Test: manual:grep -c pattern file  # 计数无断言
Test: manual:true                  # 恒真，无意义
Test: manual:curl localhost:5221/  # CI 无服务器，必然失败
```

### 禁止使用（CI 会失败）

| 禁止格式 | 原因 | 替代方案 |
|---------|------|----------|
| `manual:curl localhost:5221/...` | L1 CI 无运行服务 | `tests/` 自动化测试 |
| `manual:psql cecelia -c "..."` | L1 CI 无 PostgreSQL | `tests/` 集成测试 |
| `manual:npm test` | L1 CI 无完整 node_modules | `Test: tests/path/to/test.ts` |
| `manual:echo "..."` | 无断言，无效测试 | `manual:node -e` |
| `manual:ls /path` | 无内容验证 | `manual:node -e "require('fs').accessSync(...)"` |

### 必须通过

- [ ] [GATE] CI 全绿（所有自动化检查通过）
  Test: contract:C2-001
- [ ] [GATE] 构建成功（无编译错误）
  Test: contract:C2-001
- [ ] [GATE] 测试通过（单元测试 + 集成测试）
  Test: contract:C2-001

---

## 范围限制

### 允许修改

- 本次 cp-* 分支涉及的模块/文件
- 相关的测试文件
- 必要的类型定义文件
- 相关的配置文件（如需要）

### 禁止修改

- 不相关的业务逻辑
- 其他模块的核心代码
- 全局配置（除非明确要求）
- 已弃用的代码（不要删除或重构）

### 代码质量要求

- [ ] [ARTIFACT] 无未使用的 import
  Test: contract:C2-001
- [ ] [ARTIFACT] 无临时文件（*New.tsx, *Old.tsx, *Backup.*）
  Test: manual:node -e "const {execSync}=require('child_process');const r=execSync('git diff --name-only HEAD',{encoding:'utf8'});if(/New\.|Old\.|Backup\./.test(r))process.exit(1)"
- [ ] [GATE] 单文件不超过 500 行
  Test: manual:node -e "const{readFileSync}=require('fs');const lines=readFileSync('path/to/file','utf8').split('\n').length;if(lines>500)process.exit(1)"

---

## 依赖检查

- [ ] [ARTIFACT] lockfile 已提交
  Test: manual:node -e "require('fs').accessSync('package-lock.json')"

---

## Git 规范

- [ ] [ARTIFACT] 分支命名符合规范（cp-任务名 或 feature/任务名）
  Test: contract:H1-002
- [ ] [ARTIFACT] 无敏感信息（.env, credentials 等）
  Test: manual:node -e "const{execSync}=require('child_process');const r=execSync('git diff --name-only HEAD',{encoding:'utf8'});if(/\.env$|\.key$|\.pem$/.test(r))process.exit(1)"

---

## P0/P1 专项（如适用）

> 如果本次修复是 P0 或 P1 级别，必须更新回归契约

- [ ] [ARTIFACT] regression-contract.yaml 已更新
  Test: contract:H2-008
- [ ] [ARTIFACT] 新增 RCI 条目覆盖本次修复
  Test: manual:node -e "const c=require('fs').readFileSync('regression-contract.yaml','utf8');if(!c.includes('new-rci-id'))process.exit(1)"

---

## 备注

<!-- 补充说明、特殊情况、技术债务等 -->
