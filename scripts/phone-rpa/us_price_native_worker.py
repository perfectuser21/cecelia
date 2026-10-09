#!/usr/bin/env python3
"""一个dispatcher、一次with-lock、一个持锁worker。导入不执行手机动作。"""
import argparse
import base64
import datetime
import json
import pathlib
import re
import sys
import time
from urllib.parse import quote as urlquote
from native_price_phone import CTL, PROFILE, AMAZON, HD, PhoneSession, command, validate_request, text_values, bounds, parse_hd_detail, price_candidates, extract_asin

def amazon_seller(values):
    return next((v for v in values if re.fullmatch(r'Sold by\s+[^\n]{1,100}',v,re.I)), '未显示（需核对）')

def utcnow(): return datetime.datetime.now(datetime.timezone.utc).isoformat()

def dispatch(request, runner=command):
    validate_request(request)
    prefix=[CTL,'--profile',PROFILE]
    preflight=runner(prefix+['preflight'])
    if 'state=device' not in preflight or 'call_state=idle' not in preflight:raise RuntimeError('手机不在线或通话中')
    if 'lock=free' not in runner(prefix+['lock-status']):raise RuntimeError('设备已有独占锁，拒绝派发')
    payload=base64.b64encode(json.dumps(request,ensure_ascii=False).encode()).decode()
    # 只有此处启动with-lock；持锁worker没有再次开锁的代码路径。
    output=runner(prefix+['with-lock',request['owner'],'--',sys.executable,str(pathlib.Path(__file__).resolve()),'--held','--request-base64',payload],timeout=1050)
    report=None
    for line in reversed(output.splitlines()):
        try: candidate=json.loads(line)
        except (ValueError,TypeError): continue
        if isinstance(candidate,dict) and isinstance(candidate.get('raw_quotes'),list):
            report=candidate;break
    if report is None:raise RuntimeError('持锁worker未返回JSON报告；检查owner目录held-report.json')
    status=runner(prefix+['preflight']); lock=runner(prefix+['lock-status'])
    report['lock_free_verified']='lock=free' in lock
    report['home_verified']=report.get('home_verified') is True and 'launcher' in status.lower()
    report['safety_verified']=all(report.get(k) is True for k in ('network_restored','home_verified','lock_free_verified'))
    if not report['safety_verified']:report['blocking_reason']='安全收尾验收未通过'
    return report

def clear_search(session,edit):
    session.tap(edit)
    # CTRL+A，再DEL：不依赖上一搜索词长度或首页状态。
    session.adb('shell','input','keycombination','113','29')
    session.adb('shell','input','keyevent','67')

def search_entry(nodes):
    visible=[n for n in nodes if bounds(n)]
    edit=next((n for n in visible if n.get('resource-id')=='main_app_header_search_text_field' or (n.get('class')=='android.widget.EditText' and 'search' in n.get('resource-id','').lower())),None)
    if edit is not None:return edit
    return next((n for n in visible if any(n.get(k,'') in ('What can we help you find?','Search') for k in ('text','content-desc'))),None)

def airship_close_button(nodes):
    if not any(n.get('class','').startswith('com.urbanairship.android.layout.widget.') for n in nodes):return None
    buttons=[n for n in nodes if n.get('clickable')=='true' and n.get('class')=='android.widget.ImageButton' and bounds(n)]
    if len(buttons)!=1:return None
    numbers=list(map(int,re.findall(r'\d+',buttons[0].get('bounds',''))))
    all_bounds=[list(map(int,re.findall(r'\d+',n.get('bounds','')))) for n in nodes]
    width=max((b[2] for b in all_bounds if len(b)==4),default=0)
    height=max((b[3] for b in all_bounds if len(b)==4),default=0)
    if len(numbers)==4 and numbers[0]>=width*.7 and numbers[1]<height*.25:return buttons[0]
    return None

def search_hd(session,keyword):
    session.adb('shell','am','force-stop',HD)
    session.launch(HD)
    for attempt in range(5):
        nodes,path=session.nodes('hd-home')
        edit=search_entry(nodes)
        if edit is not None:break
        close=airship_close_button(nodes)
        if close is not None:session.tap(close)
        if attempt<4:time.sleep(3)
    if edit is not None and edit.get('resource-id')!='main_app_header_search_text_field' and edit.get('class')!='android.widget.EditText':
        session.tap(edit);nodes,path=session.nodes('hd-search-focus')
        edit=next((n for n in nodes if n.get('resource-id')=='main_app_header_search_text_field' or n.get('class')=='android.widget.EditText'),None)
    if edit is None:raise RuntimeError('HomeDepot原生搜索框未就绪')
    clear=next((n for n in nodes if n.get('content-desc','').lower()=='clear search'),None)
    if clear is not None:session.tap(clear)
    else:clear_search(session,edit)
    session.input(keyword);session.adb('shell','input','keyevent','66');time.sleep(3)
    for attempt in range(5):
        nodes,path=session.nodes('hd-search-results')
        if hd_candidates(nodes):return nodes,path
        time.sleep(2)
    raise RuntimeError('HomeDepot原生搜索未出现商品结果')

def hd_candidates(nodes):
    candidates=[]
    for node in nodes:
        value=node.get('text','') or node.get('content-desc','')
        if node.get('clickable')!='true' or not bounds(node) or not 25<len(value)<700:continue
        if any(x in value.lower() for x in ('sign in','privacy','permission','filter','feedback','protection plan','magic apron','credit card','save $','shop all','departments','discover great','special buy')):continue
        resource=node.get('resource-id','').lower()
        first=value.split()[0]
        product_context=any(x in resource for x in ('product','sku','result')) or 'Model #' in value or bool(re.search(r'\$[0-9]+\.[0-9]{2}',value)) or (first.isupper() and len(first)>=2 and any(x in value.lower() for x in ('drill','tool','kit','saw','charger','battery','hammer','lawn','paint','light','door','faucet')))
        if product_context and value not in [v for v,n in candidates]:candidates.append((value,node))
    return candidates

def discover_hd(session,keyword,count):
    nodes,path=search_hd(session,keyword)
    titles=[]
    for page in range(5):
        titles.extend(value for value,node in hd_candidates(nodes) if value not in titles)
        if len(titles)>=count:
            session.hd_results=(nodes,path)
            return titles[:count]
        session.swipe(); nodes,path=session.nodes('hd-candidate-page')
    return titles[:count]

def initial_hd_result(session,candidate,keyword=None):
    cached=getattr(session,'hd_results',None)
    if cached and any(value==candidate for value,node in hd_candidates(cached[0])):
        session.hd_results=None
        return cached
    return search_hd(session,keyword)

def hd_quote(session,keyword,candidate,index,zip_code):
    nodes,path=initial_hd_result(session,candidate,keyword)
    target=None
    for page in range(5):
        try:target=session.find(nodes,candidate,True);break
        except RuntimeError:session.swipe();nodes,path=session.nodes('hd-find-candidate')
    if target is None:raise RuntimeError('候选商品不在有界结果页中')
    session.tap(target); time.sleep(3)
    title_xml=None
    seen=[];price_xml=None;zip_xml=None
    for attempt in range(5):
        nodes,path=session.nodes('hd-detail')
        values=text_values(nodes);seen.extend(nodes)
        if 'Error Page' in values:raise RuntimeError('HomeDepot原生详情Error Page')
        if any('Model #' in value or 'Internet #' in value for value in values):title_xml=path;break
        if any(len(v)>40 and 'The Home Depot' in v for v in values):title_xml=path;break
        time.sleep(1)
    if not title_xml:raise RuntimeError('商品详情未就绪')
    for page in range(5):
        try:
            seen.extend(nodes)
            current_values=text_values(nodes)
            if price_candidates(current_values) and price_xml is None:price_xml=path
            if zip_code in '\n'.join(current_values):zip_xml=path
            result=parse_hd_detail(seen,zip_code)
            result.update({'package':HD,'zip':zip_code,'seller':'The Home Depot','availability':'; '.join(v for v in text_values(nodes) if any(x in v.lower() for x in ('available','ready to ship','delivery','ship to store','free')))[-700:], 'conditions':'税费未知；优惠和分期价格不是默认标价', 'price_xml':price_xml or path, 'title_xml':title_xml,'zip_xml':zip_xml or path,'screenshot_path':session.snapshot(f'hd-{index}-price'),'collected_at':utcnow(),'action_owner':session.owner})
            return result
        except ValueError:session.swipe();nodes,path=session.nodes('hd-price-page')
    raise RuntimeError('有界商品详情缺少型号/ID/ZIP/价格证据')

def amazon_search(session,model):
    session.launch(AMAZON,'https://www.amazon.com/s?k='+urlquote(model))
    for attempt in range(5):
        nodes,path=session.nodes('amazon-search')
        values=text_values(nodes)
        if any('读取设备应用列表' in v for v in values):
            session.tap(session.find(nodes,'禁止',True));continue
        candidates=[n for n in nodes if bounds(n) and len(n.get('text','') or n.get('content-desc',''))>25 and model.lower() in (n.get('text','')+' '+n.get('content-desc','')).lower() and n.get('class')!='android.widget.EditText']
        if candidates:return candidates[:2]
        time.sleep(2)
    raise RuntimeError('Amazon原生搜索未出现同型号候选')

def amazon_quote(session,hd,index,zip_code):
    candidates=amazon_search(session,hd['model'])
    failures=[]
    for candidate_index in range(min(2,len(candidates))):
        if candidate_index:candidates=amazon_search(session,hd['model'])
        session.tap(candidates[candidate_index]);time.sleep(3)
        title_xml=None
        for attempt in range(5):
            nodes,path=session.nodes('amazon-detail')
            values=text_values(nodes); joined='\n'.join(values)
            if hd['model'].lower() in joined.lower() and any(x in joined.lower() for x in ('buy now','add to cart','in stock')):
                title_xml=path;break
            time.sleep(2)
        if not title_xml:
            failures.append('同型号详情未就绪');continue
        quote=None; asin=None
        for page in range(5):
            values=text_values(nodes);joined='\n'.join(values)
            asin=asin or extract_asin(joined)
            candidates_price=price_candidates(values)
            if candidates_price and zip_code in joined:
                title=next((v for v in values if hd['model'].lower() in v.lower() and len(v)>25),None)
                if not title:
                    title_nodes,_=session.nodes('amazon-title-check')
                    title=next((v for v in text_values(title_nodes) if hd['model'].lower() in v.lower() and len(v)>25),None)
                if not title:
                    # 原始标题XML来自同一个实际详情页，不能从另一平台补标题。
                    import xml.etree.ElementTree as ET
                    title=next((v for v in text_values(list(ET.parse(title_xml).getroot().iter('node'))) if hd['model'].lower() in v.lower() and len(v)>25),None)
                if title:
                    seller=amazon_seller(values)
                    quote={'package':AMAZON,'title':title,'brand':title.split()[0],'model':hd['model'],'specification':title,'zip':zip_code,'price_candidates':candidates_price,'seller':seller,'availability':'; '.join(v for v in values if any(x in v.lower() for x in ('in stock','delivery','arrives')))[-700:],'conditions':'税费/运费未知；仅新货标价可与另一平台比较','price_xml':path,'title_xml':title_xml,'zip_xml':path,'screenshot_path':session.snapshot(f'amazon-{index}-price'),'collected_at':utcnow(),'action_owner':session.owner}
                    break
            session.swipe();nodes,path=session.nodes('amazon-price-page')
        if not quote:failures.append('详情缺少同型号/ZIP/标价');continue
        # 只读当前已采原生节点；链接可选，不为ASIN额外翻页或读取剪贴板。
        asin=asin or extract_asin('\n'.join(text_values(nodes)))
        if not asin:
            quote.update({'url':None,'url_missing':True,'status':'已核验','conditions':quote['conditions']+'；商品链接未采集'})
            return quote
        quote.update({'url':'https://www.amazon.com/dp/'+asin,'url_source':'原生App ASIN '+asin,'url_xml':path})
        return quote
    raise RuntimeError('; '.join(failures))

def held_worker(request,session=None):
    validate_request(request)
    session=session or PhoneSession(request['owner'])
    session.deadline=time.monotonic()+min(720,180+180*request['count'])
    report={'raw_quotes':[],'unmatched':[],'action_owner':request['owner'],'started_at':utcnow(),'network_restored':False,'home_verified':False,'lock_free_verified':False,'blocking_reason':None}
    try:
        session.check()
        session.exit_node('mac-mini-m4-us',require_initial=True)
        titles=discover_hd(session,request['keyword'],request['count'])
        if not titles:raise RuntimeError('关键词没有原生商品候选')
        for index,title in enumerate(titles):
            try:
                hd=hd_quote(session,request['keyword'],title,index,request['zip'])
                report['raw_quotes'].append(hd)
                try:report['raw_quotes'].append(amazon_quote(session,hd,index,request['zip']))
                except Exception as error:report['unmatched'].append({'model':hd['model'],'platform':'Amazon US','reason':str(error)[:400]})
            except Exception as error:report['unmatched'].append({'candidate':title[:200],'reason':str(error)[:400]})
    except Exception as error:report['blocking_reason']=str(error)[:500]
    finally:
        session.cleanup=True
        try:
            if getattr(session,'restore_allowed',False):
                report['restored_network']=session.exit_node('None')
                report['network_restored']=True
            else:report['blocking_reason']=report['blocking_reason'] or '原出口未获准更改'
        except Exception as error:report['cleanup_error']=str(error)[:400]
        try:
            session.check();session.ctl('return-safe-desktop');status=session.check()
            report['home_verified']='launcher' in status.lower()
        except Exception as error:report['home_error']=str(error)[:400]
        report['ended_at']=utcnow()
        # 在控制器打印锁日志或外层解析失败前，先持久化真实收尾与采集原因。
        report_path=session.root/'held-report.json'
        report_path.write_text(json.dumps(report,ensure_ascii=False),encoding='utf-8')
        report_path.chmod(0o600)
    return report

def public_report(report):
    # 精确出口IP只留设备本地报告，不发送到模型/任务日志。
    public={key:value for key,value in report.items() if key!='restored_network'}
    network=report.get('restored_network')
    if network:
        public['restored_network']={key:network[key] for key in ('exit_node','xml','screenshot') if key in network}
        public['restored_network']['country']=network.get('country') or network.get('ip',{}).get('countryCode')
    return public

def main():
    parser=argparse.ArgumentParser(description='只支持53132的原生关键词查价固定worker')
    parser.add_argument('--request-base64',required=True)
    parser.add_argument('--held',action='store_true')
    args=parser.parse_args()
    request=json.loads(base64.b64decode(args.request_base64).decode())
    report=held_worker(request) if args.held else dispatch(request)
    print(json.dumps(public_report(report),ensure_ascii=False,separators=(',',':')),flush=True)

if __name__=='__main__':main()
