---
task_id: fa872516-0694-46ed-b9f1-ce81763ca9b4
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS

```command
python3 - <<'PY'
from pathlib import Path
root = Path("packages/brain/scripts/coding-workflow")
readme = (root / "runner/README.md").read_text()
section = readme.split("## QA 修复的文件合同与验证方式\n", 1)[1]
gate = (root / "runner/lib/qa-gate.mjs").read_text()
prompt = (root / "prompts/qa-fix.md").read_text()
adapter = (root / "lib/claude.mjs").read_text()
required = ["qaFix", "loadPrompt('qa-fix', ...)", "prompts/qa-fix.md", "runClaude", "provider", "CODING_WF_PROVIDER", "INTENT_PATH", "SPEC_PATH", "共同限定允许修改的文件与操作", "通用修复和验证规则不增加授权"]
assert all(s in section for s in required), [s for s in required if s not in section]
assert "loadPrompt('qa-fix'," in gate and "await runClaude({" in gate
assert "INTENT_PATH: path.join(worktree, intent.sprintDir, '01-intent.md')" in gate
assert "SPEC_PATH: path.join(worktree, intent.sprintDir, '02-spec.md')" in gate
assert "先读 INTENT_PATH 与 SPEC_PATH" in prompt
assert "不构成新增文件或操作的授权" in prompt
assert "process.env.CODING_WF_PROVIDER" in adapter
print("I-1 内容断言通过：README 新节、qaFix 调用链、qa-fix 提示词与 provider 选择一致")
PY
```

```output
I-1 内容断言通过：README 新节、qaFix 调用链、qa-fix 提示词与 provider 选择一致
```

### E-2
对应: I-2
verdict: PASS

```command
python3 - <<'PY'
from pathlib import Path
text = Path("packages/brain/scripts/coding-workflow/runner/README.md").read_text()
heading = "## QA 修复的文件合同与验证方式\n"
required = (
    "可失败只读内容断言和内存破坏对抗",
    "修复前运行同一断言得 RED",
    "修复后运行得 GREEN",
    "原生命令、完整捕获输出、整数退出码及失败、修正、重复、零输出",
    "不得为通用 TDD 新增合同禁止的仓库测试、程序或配置",
    "不得先提交越界文件再删除以掩盖逐父历史",
)
forbidden = ("允许修改 tests", "允许运行产品 CLI", "允许新增仓库测试")
def accepts(document):
    if document.count(heading) != 1:
        return False
    section = document.split(heading, 1)[1]
    return all(s in section for s in required) and not any(s in section for s in forbidden)
assert accepts(text)
print("GREEN 原文：可失败断言、原生记录与范围限制齐备")
for label, variant in (
    ("删除新节", text.replace(heading, "", 1)),
    ("反转 RED", text.replace("修复前运行同一断言得 RED", "修复前运行同一断言得 GREEN", 1)),
    ("夹带文件授权", text + "\n允许修改 tests\n"),
    ("夹带操作授权", text + "\n允许运行产品 CLI\n"),
):
    assert not accepts(variant), label
    print("RED " + label + "：同一断言拒绝")
PY
```

```output
GREEN 原文：可失败断言、原生记录与范围限制齐备
RED 删除新节：同一断言拒绝
RED 反转 RED：同一断言拒绝
RED 夹带文件授权：同一断言拒绝
RED 夹带操作授权：同一断言拒绝
```

### E-3
对应: I-3
verdict: PASS

```command
python3 - <<'PY'
from pathlib import Path
text = Path("packages/brain/scripts/coding-workflow/runner/README.md").read_text().split("## QA 修复的文件合同与验证方式\n", 1)[1]
required = [
    "代码 bug 仍须在原 intent/spec 允许的文件与操作范围内先写失败测试",
    "再修复并永久保留回归",
    "文档分档不能免除代码回归",
    "修复者不提交改动",
    "最后独立一行输出 `RULING_CONFLICT:",
    "由既有控制器识别并升级",
    "不自动放宽合同或裁决",
    "不声称新增机械 allowlist",
    "受保护路径与削弱测试检查保持",
]
missing = [x for x in required if x not in text]
assert not missing, missing
print("I-3 内容断言通过：代码回归、冲突升级与保护边界均在新增小节")
PY
```

```output
I-3 内容断言通过：代码回归、冲突升级与保护边界均在新增小节
```

### E-4
对应: I-4
verdict: PASS

```command
python3 - <<'PY'
from pathlib import Path
import subprocess
base = "5f514a8523ef3f40fb671ff8f3a90947597d0628"
path = "packages/brain/scripts/coding-workflow/runner/README.md"
def git(*args):
    return subprocess.check_output(["git", *args])
head = git("rev-parse", "HEAD").decode().strip()
subprocess.check_call(["git", "merge-base", "--is-ancestor", base, head])
original = git("show", base + ":" + path)
current = Path(path).read_bytes()
heading = "## QA 修复的文件合同与验证方式\n".encode()
assert current.startswith(original + b"\n" + heading)
assert current.count(heading) == 1
base_mode = git("ls-tree", base, path).decode().split()[0]
head_mode = git("ls-tree", head, path).decode().split()[0]
assert base_mode == head_mode == "100644"
parents = git("rev-list", "--parents", base + ".." + head).decode().splitlines()
changed = []
for line in parents:
    child, *ancestors = line.split()
    for parent in ancestors:
        raw = git("diff-tree", "-r", "--raw", "--no-abbrev", parent, child).decode()
        print("逐父 raw", parent, "→", child, raw.strip() or "<空>")
        changed.extend(x.split("\t", 1)[1] for x in raw.splitlines() if "\t" in x)
assert changed == [path], changed
assert git("diff", "--cached", "--raw") == b""
assert git("diff", "--raw") == b""
untracked = git("ls-files", "--others", "--exclude-standard").decode().splitlines()
assert all(x.startswith("sprints/10260827-cw-fa872516/") for x in untracked), untracked
section = current.split(heading, 1)[1].decode()
required = [
    "当前 QA 只在精确测试 HEAD 上",
    "不读 03/04 正文或保护根",
    "控制器临时隐藏 03/04",
    "固定 initial base `5f514a8523ef3f40fb671ff8f3a90947597d0628`",
    "完整 DAG 每条父边的递归文件级 raw 路径/blob/mode",
    "当前 index、worktree、全仓 untracked",
    "仅独立 judge 可用已登记 build/verify 的 `historical_execution`",
    "缺证记 UNKNOWN",
    "冻结 C01-C12",
    "正式 source/CI/preview",
    "真实 MERGED",
    "Brain/Learning 读回及下次 tick 回收",
    "未发生不得 PASS",
]
assert all(x in section for x in required), [x for x in required if x not in section]
print("HEAD", head)
print("README 前缀 bytes", len(original), "mode", base_mode, "→", head_mode)
print("DAG 父边", sum(len(line.split()) - 1 for line in parents), "变更路径", changed)
print("index/worktree raw 均为空；全仓 untracked", len(untracked), "项，均在当前 sprint 目录")
print("I-4 内容断言通过")
PY
```

```output
逐父 raw 5f514a8523ef3f40fb671ff8f3a90947597d0628 → 8bd080d6b3e7eae5383d45746c3f946ce3ffd3c6 :100644 100644 66e0b30550907c3735833366a590f7630bd2def4 2916a62eec87de33983b0e6bfada686af213651b M	packages/brain/scripts/coding-workflow/runner/README.md
HEAD 8bd080d6b3e7eae5383d45746c3f946ce3ffd3c6
README 前缀 bytes 23226 mode 100644 → 100644
DAG 父边 1 变更路径 ['packages/brain/scripts/coding-workflow/runner/README.md']
index/worktree raw 均为空；全仓 untracked 11 项，均在当前 sprint 目录
I-4 内容断言通过
```

### E-5
对应: I-4
verdict: PASS

```command
python3 - <<'PY'
from pathlib import Path
section = Path("packages/brain/scripts/coding-workflow/runner/README.md").read_text().split("## QA 修复的文件合同与验证方式\n", 1)[1]
required = [
    "已登记 build/verify 的 `historical_execution`",
    "绑定真实 stage/head/native",
    "03/04 原 bytes/mode 的真实完整恢复",
    "受保护来源门",
    "失败、修正、重复、零输出及 draft FAIL/CANNOT_VERIFY",
    "`aggregated_output` 是聚合捕获",
    "不宣称任意子进程 stdout/stderr 完整分流",
    "缺证记 UNKNOWN",
    "不重造发布前 index/worktree/untracked",
    "发布前 verify 当场核固定 base 至当时 HEAD",
    "精确批准 HEAD",
    "真实 MERGED",
    "Brain/Learning 读回及下次 tick 回收",
    "冻结 C01-C12",
]
assert all(x in section for x in required), [x for x in required if x not in section]
print("I-4 阶段边界断言通过：当前 QA、历史 judge、恢复及外层终态分别写明")
PY
```

```output
I-4 阶段边界断言通过：当前 QA、历史 judge、恢复及外层终态分别写明
```
