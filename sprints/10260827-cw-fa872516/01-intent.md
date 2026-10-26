---
task_id: fa872516-0694-46ed-b9f1-ce81763ca9b4
step: intent
upstream: []
---
# QA 修复的文件合同与验证方式

## 背景

QA 修复的文件合同与验证方式。本任务只执行以下业务合同；四条产品验收见独立 acceptance 字段。
固定 initial base_sha=5f514a8523ef3f40fb671ff8f3a90947597d0628；所有范围比较始终使用此固定完整SHA，不改为浮动main。

{
  "product_path": "packages/brain/scripts/coding-workflow/runner/README.md",
  "product_scope": "只在固定基线README文末追加新小节；原整bytes/mode/先后顺序完整保留，不复制任何未合并旧B内容。不得改程序/仓库测试/配置/开关/凭据/运行状态。 仅追加此new_section_heading的新节；已有A14及所有基线整bytes/mode保持为前缀。内容断言针对本轮新增小节，不能靠基线已有文字过绿。",
  "stage_responsibility": {
    "build": "先运行真正可失败的只读内容断言留RED，再追加文档，同断言真实GREEN；完整失败/修正/重复/零输出原生由控制器留，不用打印PASS代替实际断言。",
    "verify": "当场核固定initialbase→当前完整DAG与全diff/index/worktree/全仓untracked，再按本task实际流水线记录排除；README原bytes/mode及manifest相对base零差异。03按本轮控制器临时隐藏解释，不读其他sprint。",
    "qa": "仅核当前精确测试HEAD的README/固定源码、本轮可失败静态断言及内存破坏对抗、initialbase完整DAG逐父raw路径blob/mode、当前全仓/index/worktree/untracked及合法来源投影。不得要求回溯发布前非Git现场，不读03/04正文/保护根，不用旧PASS或登记hash追认历史。",
    "judge": "在当前QA语义/本轮原生账/03+04实际完整恢复基础上，独立使用judge-only historical_execution绑定已登记build/verify的stage/head/native原命令完整捕获输出/整数退出；仅核旧事实，不把它当当前QA执行或产品PASS。缺证如实UNKNOWN，不伪造/重跑旧现场。",
    "outer": "冻结C01-C12原文不改；发布/正式source+CI+preview/精确批准HEAD及实际MERGED/Brain/Learning读回/下次tick回收在实际发生后独立核。未发生不PASS，旧所有样本和失败不追认。"
  },
  "qa_isolation": "本轮QA只按可信投影解释03/04暂隐藏，明确恢复尚未发生；会话后控制器按原bytes/mode恢复，独立judge核本task/round/head/run/protectedreceipt；缺证/越界不能PASS。",
  "history_boundary": "完整原生账含失败、修正、重复、零输出；draft语义FAIL/CANNOT不得编译成PASS；捕获aggregated_output不声称任意child stdout/stderr完整。QA当前内容与历史judge材料严格分开。",
  "source_metadata": "模型不编辑/暂存/提交manifest；仅可信控制器按既有精确许可为本task实际合法Markdown前插准确owner run-once.mjs/documentation，旧raw历史保留。未支持附件诚实失败，不删改名伪装规避。",
  "preview_identity_rule": "本轮QA仅可对可信控制器提供且本轮固定的env_url，要求literal localhost或127.0.0.1并同origin，只读GET /api/brain/health核exact preview HEAD/隔离；不跟随重定向扩域、不请求其他API/外网/POST、不伪造header/读取凭据/扫端口，不执行产品CLI。该身份GET不是产品smoke/PASS证据；内容验收仍可失败静态/内存对抗。",
  "exact_head_rule": "始终保留QA tested_head及其原native。代码/产品/可信main同步产生新HEAD须重新真实QA+judge及CI/preview；若现有合同明确允许本轮05/06纯登记提交，必须由真实protectedsource链严格验证仅准确当前轮记录、未改产品/旧history，并实际将approved.head合法绑定该记录HEAD；不伪称模型测过新recordHEAD。最终required/source/Preview必须是实际最终HEAD，不拿旧head检查信用替代；合并仍真实批准head CAS。不得把合法登记提交强迫成无限QA再登记循环，也不得借record名义跳过任何代码/产品重验。",
  "record_scope_rule": "完整initial base→当前HEAD所有父边path/blob/mode/全差异/index/worktree/全仓untracked须留证；仅准确本任务合法Markdown与可信manifest documentation增量可归本任务，旧raw与顺序保留。main同步只能已有完整可信链/精确双父+actualmainref/全tree/sourcegate证明且不触本任务产品/报告，不能简单减main或浮动base。 文件级逐父审计使用 git diff-tree -r --raw --no-abbrev <parent> <child>，不能只取目录tree项。",
  "new_section_heading": "## QA 修复的文件合同与验证方式"
}

### I-1
I1：README文末新节准确说明runner/lib/qa-gate.mjs的qaFix经loadPrompt(qa-fix)交provider适配器执行；prompts/qa-fix.md先读INTENT_PATH与SPEC_PATH共同限定文件和操作范围，通用修复/验证规则不构成新增授权；函数历史名runClaude不代表必须使用Claude账号，Codex实际通道按现行配置选择。

### I-2
I2：只读内容断言与内存对抗是合同许可的文档/限定文件验证方式：真正RED后修复、同断言GREEN，保真实原生命令/输出/退出及失败重复零输出；不得为通用TDD新增合同禁止的测试/程序/配置，也不能提交越界文件后再删除掩盖逐父历史。本文档任务不新增仓库测试或调用产品CLI。

### I-3
I3：代码bug仍须在原合同允许范围先写失败测试、修复并永久保留回归，不能借文档分档省略代码回归。不能在原范围内完成时不提交改动，最后独立行RULING_CONFLICT由既有控制器识别并升级；不自动放宽原intent/spec或前轮裁决，不声称新增机械语义allowlist，受保护路径和削弱测试检查保持。

### I-4
I4：准确区分当前QA静态/内存断言与judge-only已登记build/verify历史原生；当前QA不读03/04正文或保护根、不重造发布前现场。固定基线完整DAG逐父递归文件级raw/当前全仓/README前缀与合法来源均核；后续恢复、精确批准head、source/CI/preview、真实MERGED、Brain/Learning及回收仍按冻结C01-C12真实核验，失败/HUMAN保留。
