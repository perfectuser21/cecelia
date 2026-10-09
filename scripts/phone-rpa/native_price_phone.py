"""小黄原生查价的持锁原语。导入不执行设备动作。"""
import datetime
import json
import pathlib
import re
import shlex
import subprocess
import time
import xml.etree.ElementTree as ET

CTL = '/Users/jinnuoshengyuan/.local/bin/douyin-phone-adb'
ADB = '/opt/homebrew/bin/adb'
SERIAL = 'ANGYVB4402004137'
PROFILE = 'legacy'
CACHE = pathlib.Path('/Users/jinnuoshengyuan/Library/Caches/us-price-native-staging/agent-runs')
AMAZON = 'com.amazon.mShop.android.shopping'
HD = 'com.thehomedepot'

def command(args, timeout=40):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    if result.returncode:
        raise RuntimeError('command_failed:' + (result.stderr or result.stdout)[:300])
    return result.stdout

def validate_request(request):
    if request.get('zip') != '53132': raise ValueError('仅ZIP53132已验收，其它邮编尚不支持')
    count = request.get('count')
    if type(count) is not int or not 1 <= count <= 3: raise ValueError('count应为1–3')
    if not isinstance(request.get('keyword'),str) or not 0 < len(request['keyword'].strip()) <= 200: raise ValueError('关键词无效')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', request.get('owner','')) or re.search(r'[-_]a[0-9]+[-_]|-w[0-9]+$',request.get('owner','')): raise ValueError('owner无效')

def text_values(nodes):
    result = []
    for node in nodes:
        for key in ('text','content-desc'):
            value = ' '.join(node.get(key,'').split())
            if value and value not in result: result.append(value)
    return result

def price_candidates(values):
    result = []
    for i,value in enumerate(values):
        for match in re.finditer(r'\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)', value):
            result.append({'amount':float(match.group(1).replace(',','')), 'text':value[:300], 'context':values[max(0,i-1):i+3]})
    return result[:12]

def extract_asin(value):
    match = re.search(r'\bASIN\s*[:#]?\s*([A-Z0-9]{10})\b', value, re.I)
    if not match: match = re.search(r'https://(?:www\.)?amazon\.com/(?:[^\s]*/)?(?:dp|gp/product)/([A-Z0-9]{10})(?:[/?\s]|$)', value, re.I)
    return match.group(1).upper() if match else None

def parse_hd_detail(nodes, zip_code):
    values = text_values(nodes)
    joined = '\n'.join(values)
    if zip_code not in joined: raise ValueError('商品详情未显示目标ZIP')
    model = re.search(r'\bModel\s*(?:#|Number\s*:?)\s*([A-Z0-9][A-Z0-9_-]{2,})', joined, re.I)
    product = re.search(r'\bInternet\s*#\s*(\d{6,12})', joined, re.I)
    if not model or not product: raise ValueError('详情缺少真实Model#/Internet#')
    title = next((v.replace(' - The Home Depot','') for v in values if model.group(1).lower() in v.lower() and len(v)>25), None)
    if not title: raise ValueError('缺少商品完整标题')
    brand = next((v[5:] for v in values if v.startswith('Shop ') and len(v)<60), title.split()[0])
    prices = price_candidates(values)
    if not prices: raise ValueError('详情缺少价格')
    return {'title':title, 'brand':brand, 'model':model.group(1), 'specification':title, 'url':'https://www.homedepot.com/p/'+product.group(1), 'url_source':'原生App Internet # '+product.group(1), 'price_candidates':prices}

def bounds(node):
    numbers = list(map(int,re.findall(r'\d+',node.get('bounds',''))))
    return numbers if len(numbers)==4 and numbers[2]>numbers[0] and numbers[3]>numbers[1] else None

def assert_app_nodes(nodes,package):
    if not nodes:return  # 空加载页无可点击/输入目标，交给有界就绪等待。
    packages={n.get('package') for n in nodes if n.get('package')}
    if package not in packages:raise RuntimeError('前台App XML包不符：预期'+package)

class PhoneSession:
    def __init__(self, owner, runner=command):
        self.owner, self.runner = owner, runner
        self.root = CACHE / owner
        self.root.mkdir(parents=True,exist_ok=True)
        self.deadline = time.monotonic()+900
        self.counter = 0
        self.cleanup = False
        self.expected_package = None
    def ctl(self, *args, timeout=40):
        return self.runner([CTL,'--profile',PROFILE,*args],timeout=timeout)
    def raw_adb(self, *args, timeout=40):
        return self.runner([ADB,'-s',SERIAL,*args],timeout=timeout)
    def check(self):
        if not self.cleanup and time.monotonic()>self.deadline: raise RuntimeError('任务达到时间上限')
        status=self.ctl('preflight'); lock=self.ctl('lock-status')
        owner=re.search(r'owner=(\S+)',lock)
        if not ('state=device' in status and 'call_state=idle' in status and 'lock=held' in lock and owner and owner.group(1)==self.owner): raise RuntimeError('设备空闲/独占锁校验失败')
        return status
    def require_foreground(self):
        expected=getattr(self,'expected_package',None)
        if not expected:return
        status=self.check();match=re.search(r'foreground=([^\s/]+)',status)
        if not match or match.group(1)!=expected:raise RuntimeError('前台App不符：预期'+expected)
    def adb(self,*args,timeout=40):
        if args[:2]==('shell','input'):self.require_foreground()
        self.check(); value=self.raw_adb(*args,timeout=timeout); self.check(); return value
    def nodes(self,label):
        self.require_foreground()
        self.counter += 1
        label=f'{self.counter}-{label}'
        remote=f'/sdcard/{self.owner}-{label}.xml'; path=self.root/(label+'.xml')
        self.adb('shell','uiautomator','dump',remote,timeout=35)
        self.adb('pull',remote,str(path),timeout=20)
        if not path.exists(): raise RuntimeError('uiautomator未产生XML')
        nodes=list(ET.parse(path).getroot().iter('node'))
        if getattr(self,'expected_package',None):assert_app_nodes(nodes,self.expected_package)
        self.require_foreground()
        return nodes,str(path)
    def tap(self,node):
        self.require_foreground()
        if getattr(self,'expected_package',None) and node.get('package')!=self.expected_package:raise RuntimeError('前台App点击节点包不符')
        box=bounds(node)
        if not box: raise RuntimeError('目标没有可见bounds')
        self.check(); self.ctl('tap',str((box[0]+box[2])//2),str((box[1]+box[3])//2)); self.check(); time.sleep(1.5)
    def find(self,nodes,needle,exact=False):
        matches=[n for n in nodes if bounds(n) and any((needle==n.get(k,'') if exact else needle.lower() in n.get(k,'').lower()) for k in ('text','content-desc'))]
        if not matches: raise RuntimeError('目标不可见:'+needle[:100])
        return matches[0]
    def snapshot(self,label):
        self.require_foreground()
        self.check(); name=self.owner+'-'+label
        receipt=self.ctl('snapshot-evidence',name)
        self.check()
        # 控制器的固定证据根；必须从实际receipt解析并校验文件存在。
        matches=re.findall(r'(/(?:private/tmp|Volumes|Users)/[^\s"\']+\.(?:png|jpg|jpeg))',receipt)
        candidates=[pathlib.Path(p) for p in matches]
        candidates += [pathlib.Path('/private/tmp/openclaw-phone/evidence/legacy')/(name+'.png')]
        path=next((p for p in candidates if p.is_file()),None)
        if not path: raise RuntimeError('截图receipt未提供存在的截图')
        return str(path)
    def launch(self,package,url=None):
        self.expected_package=None
        if url:self.adb('shell','am','start','-W','-a','android.intent.action.VIEW','-d',shlex.quote(url),'-p',package)
        else:
            activity=self.adb('shell','cmd','package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-p',package).strip().splitlines()[-1]
            if '/' not in activity: raise RuntimeError('无法解析原生App启动Activity')
            self.adb('shell','am','start','-W','-n',activity)
        time.sleep(3)
        for attempt in range(2):
            nodes,path=self.nodes('launch-permission')
            if not any('读取设备应用列表' in v for v in text_values(nodes)):break
            self.tap(self.find(nodes,'禁止',True))
        self.expected_package=package
        for attempt in range(3):
            try:self.require_foreground();break
            except RuntimeError:
                if attempt==2:raise
                time.sleep(1)
        assert_app_nodes(nodes,package)
    def swipe(self):
        self.require_foreground()
        self.check(); self.ctl('swipe','600','2100','600','700','600'); self.check(); time.sleep(1)
    def back(self):
        self.require_foreground()
        self.check(); self.ctl('back'); self.check(); time.sleep(1)
    def input(self,value):
        self.require_foreground()
        if not re.fullmatch(r'[A-Za-z0-9 _.,/-]{1,200}',value): raise ValueError('首版原生搜索仅支持英文/数字关键词')
        self.adb('shell','input','text',shlex.quote(value.replace(' ','%s')))
    def current_ip(self):
        request='GET /json/ HTTP/1.1\r\nHost: ip-api.com\r\nConnection: close\r\n\r\n'
        error=None
        for attempt in range(2):
            try:
                out=self.adb('shell','printf %s '+shlex.quote(request)+' | nc -w 15 ip-api.com 80',timeout=25)
                start=out.find('{')
                if start<0:raise RuntimeError('出口IP证据缺失')
                data=json.loads(out[start:])
                if not data.get('query') or not re.fullmatch(r'[A-Z]{2}',data.get('countryCode','')):raise RuntimeError('出口国家/IP响应无效')
                return {k:data.get(k) for k in ('query','countryCode','regionName','city')}
            except Exception as failure:
                error=failure
                if attempt==0:time.sleep(2)
        raise RuntimeError('ip-api.com出口探针2次失败：'+str(error)[:300]) from error
    def exit_node(self,target,require_initial=False):
        self.launch('com.tailscale.ipn')
        nodes,path=self.nodes('exit-entry')
        values=text_values(nodes)
        if 'Connected' not in values and any(n.get('content-desc')=='Clear search' for n in nodes):
            self.tap(self.find(nodes,'Clear search',True))
            for attempt in range(3):
                nodes,path=self.nodes('exit-search-cleared')
                values=text_values(nodes)
                if 'Connected' in values:break
                self.back()
            nodes,path=self.nodes('exit-main');values=text_values(nodes)
        if 'Connected' not in values:raise RuntimeError('Tailscale Connected未核验')
        existing='mac-mini-m4-us' if 'mac-mini-m4-us' in values else ('None' if 'None' in values else None)
        if existing is None:raise RuntimeError('当前出口无法核验')
        if require_initial:
            if existing!='None':raise RuntimeError('初始出口不是None，拒绝更改')
            self.initial_exit_none=True
            if self.current_ip().get('countryCode')!='CN':raise RuntimeError('初始直连不是国内出口')
            self.restore_allowed=True
        if existing!=target:
            self.tap(self.find(nodes,existing,True)); nodes,path=self.nodes('exit-options')
            self.tap(self.find(nodes,target,True)); time.sleep(3)
        nodes,path=self.nodes('exit-verified'); values=text_values(nodes)
        if not (target in values and 'Connected' in values):raise RuntimeError('目标出口未核验')
        observed=self.current_ip()
        if observed.get('countryCode')!=('CN' if target=='None' else 'US'):raise RuntimeError('出口国家不符')
        return {'exit_node':target,'ip':observed,'xml':path,'screenshot':self.snapshot('exit-'+target)}
