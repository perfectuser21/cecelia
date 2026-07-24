# Learning — Codex Slot 安全硬切换

## 运行指标

- GAN 轮次：4
- Evaluator Fix 次数：0（合同门禁终止，Evaluator 未运行）
- 总成本：$0（unsettled）
- PR：未创建
- Sprint Dir：sprints/07240705-relay-56bf3e23
- 终局：FAIL / contract_invalid

## 发现的问题

### [PROMPT] Prompt 类问题

- 现象：已批准合同的 ARTIFACT #10 在机械复现时由 bash 报 `bad substitution`，Node oracle 没有启动。根因：GAN 审查只确认了文本与 `bash -n`，未逐条在批准前真实执行 `manual:node -e`；shell 双引号中的 JavaScript `${}` 被 bash 当作参数展开。修法：在 GAN 批准前逐条真跑所有 manual oracle，涉及 `node -e` 时优先用单引号保护 JavaScript，或把脚本落为独立文件后执行。

### [BUG] 代码缺陷

无（本次未进入业务实现阶段）

### [INFRA] 基础设施问题

- 现象：`bash -n` 通过，但真实命令仍在 expansion 阶段失败。根因：`bash -n` 只能证明语法可解析，不能覆盖参数展开产生的运行时错误。修法：合同门禁同时执行 shell 语法检查与无副作用的真实 oracle 机械复现，不能以 `bash -n` 代替执行。

### [DESIGN] 设计缺陷

- 现象：批准后的合同出现不可执行 oracle，只能终止整个 run。根因：不可变合同与批准前验证覆盖不足叠加，使修复只能转入新合同轮次。修法：保持 CONTRACT IS LAW，不在批准后热修合同；把 manual oracle 真跑设为批准前硬闸。

## 下次预防清单

- [ ] `manual:node -e` 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，`bash -n` 不足以捕获 expansion failure。
- [ ] 合同批准前记录每条 manual oracle 的真实 exit code，并确认目标解释器确实启动。
- [ ] Node 一行 oracle 含 shell 敏感字符时使用安全 quoting 或独立脚本文件，避免 shell 抢先展开。

