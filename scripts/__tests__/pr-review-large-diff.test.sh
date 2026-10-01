#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "$REPO_ROOT" <<'PY'
import os,pathlib,subprocess,sys,tempfile,json
root=pathlib.Path(sys.argv[1]);workflow=(root/'.github/workflows/pr-review.yml').read_text()
def block(name):
 part=workflow.split('- name: '+name,1)[1].split('\n      - name:',1)[0]
 return '\n'.join(line[10:] for line in part.split('        run: |\n',1)[1].splitlines()).replace('${{ github.event.pull_request.number }}','42')
with tempfile.TemporaryDirectory(prefix='pr-review-large-') as tmp:
 p=pathlib.Path(tmp);bin=p/'bin';bin.mkdir();envfile=p/'github-env';envfile.touch()
 # 单行超过 Linux MAX_ARG_STRLEN，并包含旧环境变量分隔符，内容必须原样进入API请求。
 long='+'+json.dumps({'schema':'x'*262144})+'\n'
 fixture='diff --git a/protocol.json b/protocol.json\n'+long+'DIFF_EOF\n'+'context\n'*497+'beyond-500-lines\n'
 (p/'fixture.diff').write_text(fixture)
 (bin/'gh').write_text('#!/bin/sh\ncat "$RUNNER_TEMP/fixture.diff"\n')
 (bin/'curl').write_text('''#!/usr/bin/env python3
import os,json,pathlib,sys
args=sys.argv[1:]
assert '--data-binary' in args, 'request body must be transferred through a file'
body=args[args.index('--data-binary')+1]
assert body.startswith('@')
p=pathlib.Path(os.environ['RUNNER_TEMP'])
data=json.loads(pathlib.Path(body[1:]).read_text())
(p/'captured.json').write_text(json.dumps(data))
print(json.dumps({'choices':[{'message':{'content':'未发现严重问题'}}]}))
''')
 for executable in bin.iterdir():executable.chmod(0o755)
 env={**os.environ,'PATH':str(bin)+':'+os.environ['PATH'],'RUNNER_TEMP':tmp,'GITHUB_ENV':str(envfile),'GITHUB_TOKEN':'fixture','OPENROUTER_API_KEY':'fixture'}
 subprocess.run(['bash','-eu','-o','pipefail','-c',block('获取 PR diff')],env=env,cwd=root,check=True,stdout=subprocess.DEVNULL)
 assert not envfile.read_text(), 'large diff must not poison subsequent process environments'
 subprocess.run(['bash','-eu','-o','pipefail','-c',block('调用 OpenRouter API 进行代码审查（含重试，fail-closed）')],env=env,cwd=root,check=True,stdout=subprocess.DEVNULL)
 data=json.loads((p/'captured.json').read_text());user=data['messages'][1]['content']
 assert long.strip() in user and 'DIFF_EOF' in user and 'beyond-500-lines' not in user
 assert data['model']=='deepseek/deepseek-chat' and data['max_tokens']==2000
 print('PASS: 超长单行diff完整进入文件请求，环境未污染，500行边界保持')
PY
