import unittest
import xml.etree.ElementTree as E
from native_price_phone import text_values, parse_hd_detail, extract_asin, price_candidates, validate_request, PhoneSession
from us_price_native_worker import dispatch, hd_candidates, amazon_quote, clear_search

def nodes(values, package='com.thehomedepot'):
    root=E.Element('hierarchy')
    for value in values: E.SubElement(root,'node',{'text':value,'package':package,'bounds':'[0,0][100,100]'})
    return list(root.iter('node'))

class NativePriceTests(unittest.TestCase):
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
        for patch in [{'zip':'10001'},{'count':4},{'owner':'../unsafe'}]:
            with self.assertRaises(ValueError):validate_request({'keyword':'drill','zip':'53132','count':1,'owner':'owner',**patch})
    def test_dispatch_holds_exactly_one_lock_and_verifies_after_release(self):
        calls=[]
        def runner(args, **kwargs):
            calls.append(args)
            if 'with-lock' in args: return '{"raw_quotes":[],"network_restored":true,"home_verified":true}'
            if 'lock-status' in args:return 'lock=free'
            return 'state=device call_state=idle foreground=com.hihonor.android.launcher'
        result=dispatch({'keyword':'drill','zip':'53132','count':1,'owner':'owner'},runner)
        self.assertEqual(sum('with-lock' in c for c in calls),1)
        self.assertTrue(result['lock_free_verified'])
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
        self.assertEqual(q['status'],'规格待核')
    def test_launch_denies_optional_app_list_permission_for_hd(self):
        import unittest.mock
        session=object.__new__(PhoneSession);taps=[]
        session.adb=lambda *args,**kwargs:'com.thehomedepot/Main'
        pages=iter([nodes(['是否允许读取设备应用列表？','禁止']),nodes(['What can we help you find?'])])
        session.nodes=lambda label:(next(pages),'/tmp/page.xml')
        session.tap=lambda node:taps.append(node.get('text'))
        with unittest.mock.patch('native_price_phone.time.sleep'):session.launch('com.thehomedepot')
        self.assertEqual(taps,['禁止'])
if __name__=='__main__':unittest.main()
