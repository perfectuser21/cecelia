---
task_id: f2980a63-f4cd-4797-a2ab-7c2bd75728d4
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS

```command
python3 - <<'PY'
import json, pathlib, re
root=pathlib.Path('packages/brain/scripts/coding-workflow')
readme=(root/'runner/README.md').read_text()
src=(root/'new-task.mjs').read_text()
section=readme.split('## 提交编码任务\n',1)[1].split('## 运行回执如何判读',1)[0]
fence=chr(96)*3
plans=[json.loads(x) for x in re.findall(fence+'json\n(.*?)\n'+fence,section,re.S)]
p=plans[0]
assert all(p.get(k) for k in ('title','change_kind','map_scope_hint','acceptance','repo','gp_anchor'))
assert p['repo']=='cecelia' and p['gp_anchor']=='none(docs)'
assert 'node packages/brain/scripts/coding-workflow/new-task.mjs <plan.json> --repo cecelia --dry-run' in section
assert all(x in section for x in ('不 POST Brain','不创建任务','退出码 0 也不证明真实提交成功','40 位小写十六进制格式','不验证该 SHA 存在','条目 repo → 计划顶层 repo → 命令行 --repo → 默认 cecelia','ZenithJoy'))
assert all(x in src for x in ('if (dryRun) {','/^[a-f0-9]{40}$/','const wanted = [t?.repo, plan?.repo, repo]',"fetch(url, { method: 'POST'",'map_scope_required','change_kind_required'))
print('I-1 PASS：单任务 JSON 字段、命令、dry-run 边界与源码静态分支一致')
PY
```

```output
I-1 PASS：单任务 JSON 字段、命令、dry-run 边界与源码静态分支一致
```

### E-2
对应: I-2
verdict: PASS

```command
python3 - <<'PY'
import json, pathlib, re
root=pathlib.Path('packages/brain/scripts/coding-workflow')
readme=(root/'runner/README.md').read_text()
src=(root/'new-task.mjs').read_text()
deps=(root/'runner/lib/deps.mjs').read_text()
section=readme.split('## 提交编码任务\n',1)[1].split('## 运行回执如何判读',1)[0]
fence=chr(96)*3
p=json.loads(re.findall(fence+'json\n(.*?)\n'+fence,section,re.S)[1])
assert p['repo']=='cecelia' and bool(p.get('project_id')) != bool(p.get('project'))
assert len(p['tasks'])==2 and p['tasks'][0]['key'] in p['tasks'][1]['depends_on']
assert all(x in section for x in ('depends_on_unknown','key_duplicate','project_required','project_conflict','status=completed','MERGED','OPEN','CLOSED','状态未知','无 PR URL','result.merged=true','正常 coding 任务应保留真实 PR URL'))
assert all(x in src for x in ('depends_on_unknown','key_duplicate','project_required','project_conflict','ids.get(k)'))
assert all(x in deps for x in ("task.status !== 'completed'","if (!url || task.result?.merged === true)","pr === 'MERGED'","pr === 'CLOSED'","return { state: 'waiting'"))
print('I-2 PASS：双任务依赖、项目约束、拒绝条件和 runner 就绪分支一致')
PY
```

```output
I-2 PASS：双任务依赖、项目约束、拒绝条件和 runner 就绪分支一致
```

### E-3
对应: I-3
verdict: PASS

```command
python3 - <<'PY'
import pathlib
root=pathlib.Path('packages/brain/scripts/coding-workflow')
readme=(root/'runner/README.md').read_text()
src=(root/'new-task.mjs').read_text()
section=readme.split('## 提交编码任务\n',1)[1].split('## 运行回执如何判读',1)[0]
assert all(x in section for x in ('真实提交','POST /api/brain/tasks','已建','失败对象 ID','逐一只读核对 Brain','不要整批盲重跑','不执行真实建单、不访问生产'))
assert '## 运行回执如何判读' in readme and 'pr_url_missing' in readme and '不手工改批准' in readme
assert all(x in src for x in ('/tasks', 'const created = []','JSON.stringify(created)','task_route_mismatch','id: reply.id'))
print('I-3 PASS：真实提交、中途失败查账、回执判读及安全边界与源码一致')
PY
```

```output
I-3 PASS：真实提交、中途失败查账、回执判读及安全边界与源码一致
```

### E-4
对应: I-4
verdict: PASS

```command
python3 - <<'PY'
import pathlib, subprocess
base='16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd'
readme='packages/brain/scripts/coding-workflow/runner/README.md'
manifest='.implementation-source-relations.json'
sprint='sprints/10242049-cw-f2980a63/'
def git(*args): return subprocess.check_output(['git',*args])
def paths(*args): return [p.decode() for p in git(*args).split(b'\0') if p]
head=paths('diff','--name-only','-z',base,'HEAD')
staged=paths('diff','--cached','--name-only','-z')
working=paths('diff','--name-only','-z')
untracked=paths('ls-files','--others','--exclude-standard','-z')
print('HEAD差异:',head)
print('暂存区差异:',staged)
print('工作区差异:',working)
print('全仓未跟踪:',untracked)
assert head==[readme] and staged==[] and working==[]
allowed={'01-intent.md','01-invariants.md','02-spec.md','02-review.md','02-review-r1.md','02-review-r2.md','02-review-r3.md','02-response-r1.md','02-response-r2.md'}
assert untracked and all(p.startswith(sprint) and p[len(sprint):] in allowed for p in untracked)
before=git('show',base+':'+readme)
after=pathlib.Path(readme).read_bytes()
offset=0
for line in before.splitlines(keepends=True):
    pos=after.find(line,offset)
    assert pos>=0, '基线原文缺失或顺序改变'
    offset=pos+len(line)
assert git('show',base+':'+manifest)==git('show','HEAD:'+manifest)==pathlib.Path(manifest).read_bytes()
print('I-4 PASS：基线README原文逐字有序保留；manifest三态一致；产品差异仅README；未跟踪均为本次流水线记录')
PY
```

```output
HEAD差异: ['packages/brain/scripts/coding-workflow/runner/README.md']
暂存区差异: []
工作区差异: []
全仓未跟踪: ['sprints/10242049-cw-f2980a63/01-intent.md', 'sprints/10242049-cw-f2980a63/01-invariants.md', 'sprints/10242049-cw-f2980a63/02-response-r1.md', 'sprints/10242049-cw-f2980a63/02-response-r2.md', 'sprints/10242049-cw-f2980a63/02-review-r1.md', 'sprints/10242049-cw-f2980a63/02-review-r2.md', 'sprints/10242049-cw-f2980a63/02-review-r3.md', 'sprints/10242049-cw-f2980a63/02-review.md', 'sprints/10242049-cw-f2980a63/02-spec.md']
I-4 PASS：基线README原文逐字有序保留；manifest三态一致；产品差异仅README；未跟踪均为本次流水线记录
```

