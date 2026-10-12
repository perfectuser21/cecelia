import json,time,urllib.request,urllib.error,pathlib
base='http://localhost:5301/api/brain'
out={'started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'base':base,'tests':[]}
def req(path,body=None):
    r=urllib.request.Request(base+path,data=json.dumps(body).encode() if body else None,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(r,timeout=20) as f:return f.status,json.load(f)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
s,h=req('/health');out['health']={'status':s,'git_sha':h['git_sha'],'runtime':h['runtime']}
assert s==200 and h['git_sha']=='23edec0ac97bdd5641c9f3a5ebf80cc9fed3746d' and h['runtime']['isolated'] is True
stamp=str(time.time_ns())
for q,m,n in [('Q-1','ai',1),('Q-2','system',1),('Q-2','user',1),('Q-2','cecelia',1),('Q-3','bogus_maker',1),('Q-4','ai',2)]:
    topic=f'判定点[qa-c8fab3c8-r3-{stamp}-{q}-{m}#1]: 部署判定'
    body={'category':'judgment','topic':topic,'decision':'所选: 健康检查｜候选: 健康检查/日志','reason':'依据: 双信号','made_by':m,'author':'coding-workflow','source_ref':f'coding-workflow:qa-c8fab3c8-r3-{stamp}'}
    posts=[req('/strategic-decisions',body) for _ in range(n)]
    code,data=req('/strategic-decisions?category=judgment&limit=1000')
    rows=[x for x in data['data'] if x['topic']==topic]
    assert code==200
    if q=='Q-3':assert posts[0][0]!=201 and posts[0][1]['success'] is False and len(rows)==0
    else:
        assert all(c==201 and p['success'] is True and p['data']['made_by']==m and p['data']['category']=='judgment' and 'violates check constraint' not in json.dumps(p) for c,p in posts)
        assert len(rows)==n and all(x['made_by']==m and x['author']=='coding-workflow' and x['category']=='judgment' for x in rows)
    out['tests'].append({'q':q,'made_by':m,'request':body,'post_responses':posts,'get_matches':rows,'verdict':'PASS'})
pathlib.Path(__file__).with_name('api-evidence.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'health':out['health'],'tests':[{k:x[k] for k in ['q','made_by','verdict']} for x in out['tests']]},ensure_ascii=False))
