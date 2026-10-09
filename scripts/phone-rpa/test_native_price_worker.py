import unittest
import xml.etree.ElementTree as E
from native_price_phone import text_values, parse_hd_detail, extract_asin, price_candidates, validate_request, PhoneSession
from us_price_native_worker import dispatch, hd_candidates, amazon_quote, clear_search, search_entry, amazon_seller, public_report, search_hd, initial_hd_result, airship_close_button, held_worker, amazon_specification

def nodes(values, package='com.thehomedepot'):
    root=E.Element('hierarchy')
    for value in values: E.SubElement(root,'node',{'text':value,'package':package,'bounds':'[0,0][100,100]'})
    return list(root.iter('node'))

class NativePriceTests(unittest.TestCase):
    def test_amazon_specification_expands_only_exact_main_details_and_is_bounded(self):
        import unittest.mock
        class Fake:
            def __init__(self):self.taps=[];self.swipes=0
            def tap(self,n):self.taps.append(n.get('text'))
            def swipe(self):self.swipes+=1
            def nodes(self,label):return nodes(['Product details','Included Components','2 batteries, charger, bag','Battery Capacity','1.3 Ah','Customer reviews','Marketing 99 batteries']),'/spec.xml'
        fake=Fake()
        with unittest.mock.patch('us_price_native_worker.time.sleep'):
            result=amazon_specification(fake,nodes(['Product details','Power Source','Battery Powered','Amperage','1.3 A','See more details']),'/initial.xml')
        self.assertEqual(fake.taps,['See more details']);self.assertLessEqual(fake.swipes,2)
        self.assertIn('2 batteries, charger, bag',str(result));self.assertNotIn('Marketing 99 batteries',str(result))
        self.assertEqual(result['spec_xml'],'/initial.xml')
        other=Fake()
        with unittest.mock.patch('us_price_native_worker.time.sleep'):
            amazon_specification(other,nodes(['Customer reviews','See more details']),'/reviews.xml')
        self.assertEqual(other.taps,[])

    def test_amazon_details_zero_height_anchor_is_not_tapped_until_visible(self):
        import unittest.mock
        class Fake:
            def __init__(self):self.swipes=0;self.taps=[]
            def swipe(self):self.swipes+=1
            def tap(self,n):self.taps.append(n.get('bounds'))
            def nodes(self,label):return nodes(['See more details','Included Components','charger']),'/visible.xml'
        fake=Fake();initial=nodes(['Product details','See more details']);initial[1].set('bounds','[45,2507][327,2507]')
        with unittest.mock.patch('us_price_native_worker.time.sleep'):
            amazon_specification(fake,initial,'/zero.xml')
        self.assertEqual(fake.taps,['[0,0][100,100]']);self.assertLessEqual(fake.swipes,2)

    def test_actual_tailscale_search_xml_cannot_be_hd_search_entry(self):
        # 66真实15-exit-main.xml的最小结构；关键词输入到了Tailscale。
        ns=nodes(['DEWALT DCD771C2','No results'],'com.tailscale.ipn')
        ns[0].set('class','android.widget.EditText');ns[0].set('content-desc','Search')
        ns[0].set('resource-id','search_field');ns[0].set('clickable','true')
        with self.assertRaisesRegex(RuntimeError,'前台App'):
            search_entry(ns)
    def test_wrong_foreground_rejects_input_before_adb_and_launch_waits(self):
        import unittest.mock
        session=object.__new__(PhoneSession);session.expected_package='com.thehomedepot';calls=[]
        session.check=lambda:'state=device call_state=idle foreground=com.tailscale.ipn'
        session.adb=lambda *args,**kw:calls.append(args)
        with self.assertRaisesRegex(RuntimeError,'前台App'):
            session.input('DEWALT DCD771C2')
        self.assertEqual(calls,[])
        session.expected_package=None
        session.nodes=lambda label:(nodes(['Search']),'/hd.xml')
        def adb(*args,**kw):calls.append(args);return 'com.thehomedepot/Main'
        session.adb=adb
        with unittest.mock.patch('native_price_phone.time.sleep'):
            with self.assertRaisesRegex(RuntimeError,'前台App'):session.launch('com.thehomedepot')
        self.assertTrue(any('start' in cmd and '-W' in cmd for cmd in calls))

    def test_seller_requires_exact_native_text_not_substring(self):
        self.assertEqual(amazon_seller(['Visit Amazon.com.evil.com']),'未显示（需核对）')
        self.assertEqual(amazon_seller(['Sold by Amazon.com']),'Sold by Amazon.com')
    def test_public_report_keeps_safety_but_not_precise_exit_ip(self):
        report={'raw_quotes':[],'network_restored':True,'restored_network':{'exit_node':'None','ip':{'query':'192.0.2.1','countryCode':'CN'},'xml':'/proof.xml'}}
        public=public_report(report)
        self.assertNotIn('ip',public['restored_network'])
        self.assertEqual(public['restored_network']['country'],'CN')
        self.assertEqual(public_report(public)['restored_network']['country'],'CN')
        self.assertEqual(report['restored_network']['ip']['query'],'192.0.2.1')
    def test_hd_waits_for_blank_loading_and_reuses_discovered_results(self):
        import unittest.mock
        class Fake:
            def __init__(self):self.dumps=0
            def adb(self,*a):pass
            def launch(self,*a):pass
            def tap(self,*a):pass
            def input(self,*a):pass
            def nodes(self,label):
                self.dumps+=1
                if self.dumps<=4:return [],'/blank.xml'
                ns=nodes(['query','DEWALT Cordless Drill Driver Kit AX1234'])
                ns[0].set('resource-id','main_app_header_search_text_field')
                ns[1].set('clickable','true')
                return ns,'/results.xml'
        fake=Fake()
        with unittest.mock.patch('us_price_native_worker.time.sleep'):
            result=search_hd(fake,'drill')
        self.assertGreaterEqual(fake.dumps,5)
        fake.hd_results=result
        with unittest.mock.patch('us_price_native_worker.search_hd',side_effect=AssertionError('unexpected cold restart')):
            self.assertEqual(initial_hd_result(fake,'DEWALT Cordless Drill Driver Kit AX1234'),result)
    def test_only_explicit_airship_overlay_allows_unique_top_right_close(self):
        ns=nodes(['','']);ns[0].set('class','com.urbanairship.android.layout.widget.WeightlessLinearLayout');ns[0].set('bounds','[0,0][1200,2640]')
        ns[1].set('class','android.widget.ImageButton');ns[1].set('clickable','true');ns[1].set('bounds','[1043,121][1200,278]')
        self.assertIs(airship_close_button(ns),ns[1])
        self.assertIsNone(airship_close_button(ns[1:]))
        extra=nodes(['another control'])[0];extra.set('clickable','true')
        self.assertIsNone(airship_close_button(ns+[extra]))
        ns[1].set('bounds','[20,1400][100,1550]');self.assertIsNone(airship_close_button(ns))
    def test_network_probe_retries_once_and_validates_country(self):
        import unittest.mock
        session=object.__new__(PhoneSession);calls=[]
        def adb(*args,**kwargs):
            calls.append(args)
            if len(calls)==1:raise TimeoutError('probe timeout')
            return 'HTTP/1.1 200 OK\r\n\r\n{"status":"success","query":"192.0.2.1","countryCode":"CN"}'
        session.adb=adb
        with unittest.mock.patch('native_price_phone.time.sleep'):
            self.assertEqual(session.current_ip()['countryCode'],'CN')
        self.assertEqual(len(calls),2)
    def test_initial_probe_failure_preserves_reason_and_verifies_unchanged_none(self):
        import tempfile
        from pathlib import Path
        class Fake:
            owner='owner';initial_exit_none=True;restore_allowed=False
            def check(self):return 'state=device call_state=idle foreground=launcher'
            def exit_node(self,*a,**kw):raise RuntimeError('ip-api.com probe timeout')
            def nodes(self,*a):return nodes(['Connected','None'],'com.tailscale.ipn'),'/unchanged.xml'
            def ctl(self,*a):return ''
        fake=Fake()
        with tempfile.TemporaryDirectory() as folder:
            fake.root=Path(folder)
            report=held_worker({'keyword':'drill','count':1,'zip':'53132','owner':'owner'},fake)
        self.assertTrue(report['network_unchanged'])
        self.assertFalse(report['network_restored'])
        self.assertEqual(report['blocking_reason'],'ip-api.com probe timeout')
    def test_attributes_not_itertext(self):
        self.assertEqual(text_values(nodes(['Brand drill','53132'])),['Brand drill','53132'])
    def test_hd_dynamic_model_id_and_prices_keep_context(self):
        parsed=parse_hd_detail(nodes(['ACME drill kit AX1234 - The Home Depot','Shop ACME','Model # AX1234','Internet # 987654321','$79.95','Pay $54 after $25 OFF','Delivering to 53132']), '53132')
        self.assertEqual(parsed['model'],'AX1234')
        self.assertEqual(parsed['url'],'https://www.homedepot.com/p/987654321')
        self.assertEqual(parsed['brand'],'ACME')
        self.assertEqual(parsed['price_candidates'][0]['amount'],79.95)
        self.assertIn('Pay',parsed['price_candidates'][1]['text'])
    def test_missing_zip_and_missing_model_reject(self):
        with self.assertRaises(ValueError): parse_hd_detail(nodes(['Model # AX1234','$79.95','10001']),'53132')
        with self.assertRaises(ValueError): parse_hd_detail(nodes(['Product','53132','$79.95']),'53132')
    def test_asin_only_from_explicit_native_evidence(self):
        self.assertEqual(extract_asin('ASIN B012345678'),'B012345678')
        self.assertEqual(extract_asin('https://www.amazon.com/dp/B012345678?tag=x'),'B012345678')
        self.assertIsNone(extract_asin('https://evil.com/dp/B012345678'))
        self.assertIsNone(extract_asin('generic keyword no ID'))
    def test_request_is_bounded_zip_explicitly_limited(self):
        validate_request({'keyword':'cordless drill','zip':'53132','count':3,'owner':'phone-price-test'})
        for patch in [{'zip':'10001'},{'count':4},{'owner':'../unsafe'},{'owner':'owner-a506-suffix'},{'owner':'owner_a3_suffix'},{'owner':'owner-w2'},{'owner':'owner:x'}]:
            with self.assertRaises(ValueError):validate_request({'keyword':'drill','zip':'53132','count':1,'owner':'owner',**patch})
    def test_dispatch_holds_exactly_one_lock_and_verifies_after_release(self):
        calls=[]
        def runner(args, **kwargs):
            calls.append(args)
            if 'with-lock' in args: return 'lock=acquired\n{"raw_quotes":[],"network_restored":true,"home_verified":true}\nlock=released'
            if 'lock-status' in args:return 'lock=free'
            return 'state=device call_state=idle foreground=com.hihonor.android.launcher'
        result=dispatch({'keyword':'drill','zip':'53132','count':1,'owner':'owner'},runner)
        self.assertEqual(sum('with-lock' in c for c in calls),1)
        self.assertTrue(result['lock_free_verified'])
        def broken(args,**kwargs):
            if 'with-lock' in args:return '{"raw_quotes":[],"blocking_reason":"original probe timeout","network_restored":false,"home_verified":true}'
            return 'lock=free state=device call_state=idle foreground=launcher'
        failed=dispatch({'keyword':'drill','zip':'53132','count':1,'owner':'owner'},broken)
        self.assertEqual(failed['blocking_reason'],'original probe timeout')
        self.assertIn('safety_error',failed)
        self.assertGreater(next(i for i,c in enumerate(calls) if 'with-lock' in c),0)
    def test_dispatch_rejects_existing_lock_without_starting_worker(self):
        calls=[]
        def runner(args,**kwargs):
            calls.append(args)
            return 'lock=held owner=other' if 'lock-status' in args else 'state=device call_state=idle'
        with self.assertRaises(RuntimeError):dispatch({'keyword':'drill','zip':'53132','count':1,'owner':'owner'},runner)
        self.assertFalse(any('with-lock' in c for c in calls))
    def test_hd_product_candidates_reject_marketing(self):
        ns=nodes(['Save $25 when you open a new credit card today','Shop all departments and discover great deals','DEWALT 20V MAX Cordless Drill Driver Kit DXX123'])
        for node in ns:node.set('clickable','true')
        self.assertEqual([v for v,n in hd_candidates(ns)],['DEWALT 20V MAX Cordless Drill Driver Kit DXX123'])
    def test_clear_existing_search_before_new_input(self):
        class Fake:
            def __init__(self):self.actions=[]
            def tap(self,node):self.actions.append('focus')
            def adb(self,*args):self.actions.append(args[-1])
        fake=Fake();clear_search(fake,nodes(['old keyword'])[0])
        self.assertIn('67',fake.actions)
    def test_hd_merge_title_and_price_pages(self):
        first=nodes(['ACME drill kit AX1234 - The Home Depot','Shop ACME','Model # AX1234','Internet # 987654321'])
        second=nodes(['$79.95','Delivering to 53132'])
        self.assertEqual(parse_hd_detail(first+second,'53132')['model'],'AX1234')
    def test_amazon_missing_asin_retains_price_as_pending(self):
        class Fake:
            owner='owner'
            def launch(self,*args):pass
            def tap(self,*args):pass
            def swipe(self):pass
            def snapshot(self,*args):return '/tmp/price.png'
            def nodes(self,*args):return nodes(['DEWALT Cordless Drill Kit DXX123','Add to Cart','$79.95','53132','In Stock'],'com.amazon.mShop.android.shopping'),'/tmp/price.xml'
        import unittest.mock
        with unittest.mock.patch('us_price_native_worker.time.sleep'):
            q=amazon_quote(Fake(),{'model':'DXX123','brand':'DEWALT'},0,'53132')
        self.assertIsNone(q['url'])
        self.assertTrue(q['url_missing'])
        self.assertEqual(q['status'],'已核验')
    def test_launch_denies_optional_app_list_permission_for_hd(self):
        import unittest.mock
        session=object.__new__(PhoneSession);taps=[]
        commands=[]
        def adb(*args,**kwargs):commands.append(args);return 'com.thehomedepot/Main'
        session.adb=adb
        pages=iter([nodes(['是否允许读取设备应用列表？','禁止']),nodes(['What can we help you find?'])])
        session.nodes=lambda label:(next(pages),'/tmp/page.xml')
        session.tap=lambda node:taps.append(node.get('text'))
        with unittest.mock.patch('native_price_phone.time.sleep'):session.launch('com.thehomedepot')
        self.assertEqual(taps,['禁止'])
        self.assertIn('-a',commands[0]);self.assertIn('android.intent.action.MAIN',commands[0]);self.assertIn('-c',commands[0]);self.assertIn('android.intent.category.LAUNCHER',commands[0]);self.assertIn('-p',commands[0])
    def test_search_entry_does_not_select_image_search(self):
        ns=nodes(['Image Search','Search'])
        self.assertEqual(search_entry(ns).get('text'),'Search')
        self.assertIsNone(search_entry(nodes(['Image Search'])))
        ns=nodes(['Image Search','old query']);ns[1].set('resource-id','main_app_header_search_text_field')
        self.assertEqual(search_entry(ns).get('text'),'old query')
if __name__=='__main__':unittest.main()
