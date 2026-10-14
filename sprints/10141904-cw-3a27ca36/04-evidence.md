---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---

### E-1
对应: I-1
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r=Path('packages/brain/scripts/coding-workflow/runner')
doc=(r/'README.md').read_text()
src=(r/'install.sh').read_text()
pairs={'CODING_WF_PROVIDER':'codex','CODING_WF_CODEX_HOME':'/Users/administrator/.codex-team1','CODING_WF_CODEX_MODEL':'gpt-6-sol','CODING_WF_JUDGE_PROVIDER':'codex','CODING_WF_JUDGE_MODEL':'gpt-6-astra','CODING_WF_REPOS':'cecelia'}
for key,value in pairs.items():
    assert f'export {key}={value}' in doc, key
    assert f'export {key}="${{{key}:-' in src, key
    print(f'{key}={value}: README 与 install.sh 对应')
assert 'bash packages/brain/scripts/coding-workflow/runner/install.sh --dry-run' in doc
assert 'CODING_WF_REPOS="$CODING_WF_REPOS" bash packages/brain/scripts/coding-workflow/runner/install.sh' in doc
assert 'export CODING_WF_REPOS="${CODING_WF_REPOS:-cecelia}"' in src
print('安装示例只启用 cecelia；未执行安装')
PY
```
```output
CODING_WF_PROVIDER=codex: README 与 install.sh 对应
CODING_WF_CODEX_HOME=/Users/administrator/.codex-team1: README 与 install.sh 对应
CODING_WF_CODEX_MODEL=gpt-6-sol: README 与 install.sh 对应
CODING_WF_JUDGE_PROVIDER=codex: README 与 install.sh 对应
CODING_WF_JUDGE_MODEL=gpt-6-astra: README 与 install.sh 对应
CODING_WF_REPOS=cecelia: README 与 install.sh 对应
安装示例只启用 cecelia；未执行安装
```

### E-2
对应: I-2
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r=Path('packages/brain/scripts/coding-workflow/runner')
d=(r/'README.md').read_text()
h=(r/'runtime-health.mjs').read_text()
u=(r/'runtime-update.mjs').read_text()
l=(r/'runtime-launch.mjs').read_text()
i=(r/'runtime-install.mjs').read_text()
p=(r/'com.cecelia.coding-workflow-runner.plist.tmpl').read_text()
s=(r/'status.mjs').read_text()
lock=(r/'runtime-lock.mjs').read_text()
for x in ['node packages/brain/scripts/coding-workflow/runner/runtime-health.mjs','launchctl print system/com.cecelia.coding-workflow-runner','launchctl print-disabled system','node packages/brain/scripts/coding-workflow/runner/status.mjs --json','plutil -extract StandardOutPath raw -o -','plutil -extract StandardErrorPath raw -o -','tail -n 100']:
    assert x in d, x
assert "['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_ACCESS_TOKEN']" in h
assert "trim() !== 'Logged in using ChatGPT'" in h
assert "authentication: 'chatgpt'" in h
assert "const provider = env.CODING_WF_PROVIDER || 'claude'" in h
assert "await checkRuntimeHealth(env" in l and "if (!verified) throw new Error('runtime_update_not_verified')" in l
assert 'runtime_install_disabled' in i and "if (entry?.[1] === 'true' || entry?.[1] === 'disabled')" in i
assert 'StandardOutPath' in p and 'StandardErrorPath' in p and '__LOG__' in p
assert "if (opts.json) console.log(JSON.stringify(rows))" in s
assert "p === '.cecelia/hb.sh'" in u and 'lights' in u and 'merge-base' in u and "'--ff-only'" in u
assert "'dirty'" in u and "'not_main'" in u and "'git_operation_in_progress'" in u and "'runtime_collision'" in u
assert 'git reset --hard' in d and 'git clean' in d and '不改用 API key、其他账号或 Claude' in d
assert "if (error.code === 'EEXIST') return null" in lock
print('I-2 文档健康检查、system 状态、日志命令与源码入口对应')
print('I-2 账号失败、自更新拒绝、旧锁保留的停止条件与源码对应')
PY
```
```output
I-2 文档健康检查、system 状态、日志命令与源码入口对应
I-2 账号失败、自更新拒绝、旧锁保留的停止条件与源码对应
```

### E-3
对应: I-3
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
import json, subprocess
b=Path('packages/brain/scripts/coding-workflow')
d=(b/'runner/README.md').read_text()
bridge=(b/'lib/preview-bridge.mjs').read_text()
browser=(b/'lib/preview-browser.mjs').read_text()
evaluate=(b/'activities/evaluate.mjs').read_text()
gate=(b/'runner/lib/qa-gate.mjs').read_text()
repos=json.loads((b/'repos.json').read_text())
lock=json.loads(Path('package-lock.json').read_text())
for x in ['本 PR 的 40 位 head SHA','同源 HTTP API','隔离 Chromium','CANNOT_VERIFY','Service Worker','跨源','playwright-1.62.1/node_modules','Chromium headless OK','PR #2132','人工放行']:
    assert x in d, x
assert 'curl -fsS "$PREVIEW_URL/api/brain/health"' in d
assert 'test -L "$CLONE_MODULES"' in d and 'readlink "$CLONE_MODULES"' in d
assert "chromium.launch({headless:true,args:[\"--single-process\",\"--no-zygote\"]})" in d
assert 'headSha, prNumber' in bridge and "body?.git_sha !== headSha" in bridge
assert "req.headers.upgrade || req.method === 'CONNECT'" in bridge
assert "location.origin !== target.origin" in bridge and 'socketPath' in bridge
assert "serviceWorkers: 'block'" in browser and "url.origin !== origin" in browser and "context.routeWebSocket('**/*'" in browser
assert "args: ['--single-process', '--no-zygote']" in browser
assert "createPreviewBridge({ origin: preview.url, headSha: input.head_sha, prNumber: input.pr_number" in evaluate
assert "preview_stale" in evaluate and "preview_unavailable" in evaluate and "CANNOT_VERIFY" in gate
assert any(x['key']=='zenithjoy-workspace' and x['automerge'] is False for x in repos['repos'])
for name in ['playwright','playwright-core']:
    v=lock['packages']['node_modules/'+name]
    assert v['version']=='1.62.1' and v['integrity']
    print(name, v['version'], 'lock integrity 存在')
changed=subprocess.check_output(['git','diff','--name-only','origin/main...HEAD'],text=True).strip().splitlines()
assert changed==['packages/brain/scripts/coding-workflow/runner/README.md'], changed
print('I-3 预览边界、可信依赖检查、人工合并声明与当前实现对应')
print('提交范围：'+', '.join(changed))
PY
```
```output
playwright 1.62.1 lock integrity 存在
playwright-core 1.62.1 lock integrity 存在
I-3 预览边界、可信依赖检查、人工合并声明与当前实现对应
提交范围：packages/brain/scripts/coding-workflow/runner/README.md
```
