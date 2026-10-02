"""仅测试：私有构造器路径映射，production JSON入口不读取本文件。"""
import hashlib
import json
from pathlib import Path
import sys
from runner import Config, Runner
import probe
root=Path(sys.argv[1]);root.mkdir(exist_ok=True)
worker={'machine_id':'fixture-machine','worker_id':'fixture-worker','host':'fixture-host'}
installation={'manifest_path':root/'manifest.json','config_path':root/'worker.json','source_root':Path(__file__).parent}
if sys.argv[2]=='setup':
    hashes={name:hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest() for name in probe.SOURCE_FILES}
    for key,value in [('config_path',worker),('manifest_path',{'schema':1,**worker,'source_hashes':hashes})]:
        installation[key].write_text(json.dumps(value));installation[key].chmod(0o600)
    print(json.dumps(probe.installed_identity(**installation)))
else:
    config=Config(**worker,journal_root=str(root/'journal'),lock_root=str(root/'locks'),drain_path=str(root/'drain'))
    print(json.dumps(Runner(config).handle_http(json.load(sys.stdin),installation=installation)))
