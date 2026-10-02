"""稳定marker与全局journal revision；仅本地事实，不代称另一机器空闲。"""
from drain_marker import marker_identity

def read_maintenance(journal,marker,scan=None):
    before_marker=marker_identity(marker)
    before=journal.activity_snapshot()
    if scan is None:
        # Hub控制账不写dispatch终态；未知业务行只能计pending。
        keys=list(journal.keys())
        for key in keys:
            if journal.read(key) is None:
                raise ValueError('phone_maintenance_unconfirmed')
        result={'pending':len(keys)}
    else:
        result=scan()
    if not isinstance(result,dict) or type(result.get('pending')) is not int or result['pending']<0:
        raise ValueError('phone_maintenance_unconfirmed')
    after=journal.activity_snapshot()
    after_marker=marker_identity(marker)
    stable=before['revision']==after['revision'] and before_marker==after_marker and result.get('stable',True) is True
    in_flight=max(before['in_flight'],after['in_flight'],result.get('in_flight',0))
    draining=before_marker is not None and after_marker is not None
    return {'draining':draining,'stable':stable,'pending':result['pending'],'in_flight':in_flight,
            'activity_revision':after['revision'],'marker_identity':after_marker,
            'quiescent':stable and draining and in_flight==0 and result['pending']==0}
