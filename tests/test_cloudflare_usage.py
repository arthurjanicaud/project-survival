from datetime import datetime,timezone
import httpx
import pytest
from operations.cloudflare_usage import collect

def test_account_analytics_sums_all_namespaces_without_exposing_the_token():
    def handler(r):
        assert r.headers['Authorization']=='Bearer private-token'
        return httpx.Response(200,json={'data':{'viewer':{'accounts':[{'durableObjectsPeriodicGroups':[{'sum':{'rowsRead':200,'rowsWritten':100}},{'sum':{'rowsRead':300,'rowsWritten':90000}}]}]}}})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        data=collect(client,{'CLOUDFLARE_ANALYTICS_TOKEN':'private-token','CLOUDFLARE_ACCOUNT_ID':'a'*32},datetime(2026,11,23,tzinfo=timezone.utc))
    assert data['reads']==500 and data['writes']==90100
    assert data['scope']=='whole-account' and data['delayed_metrics']
    assert 'private-token' not in str(data)

def test_missing_analytics_are_unknown_and_provider_errors_never_become_zero_usage():
    with httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'errors':[{'message':'not allowed'}]}))) as client:
        assert collect(client,{})['configured'] is False
        with pytest.raises(RuntimeError,match='denied'):
            collect(client,{'CLOUDFLARE_ANALYTICS_TOKEN':'secret','CLOUDFLARE_ACCOUNT_ID':'a'*32})

def test_wrong_or_missing_account_is_not_reported_as_an_empty_quota():
    with httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'data':{'viewer':{'accounts':[]}}}))) as client:
        with pytest.raises(RuntimeError,match='not accessible'):
            collect(client,{'CLOUDFLARE_ANALYTICS_TOKEN':'secret','CLOUDFLARE_ACCOUNT_ID':'a'*32})

def test_provider_validation_refuses_an_existing_experiment_before_any_mutation(monkeypatch):
    from operations import reform_validation
    seen=[]
    def handler(r):
        seen.append((r.method,r.url.path))
        return httpx.Response(200,json={'run':{'status':'FINISHED'},'state':{'started_at':'2026-11-11T00:00:00Z'}})
    client=httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(reform_validation,'configuration',lambda:{'COUNCIL_API_URL':'https://unit.test','COUNCIL_ADMIN_TOKEN':'secret'})
    monkeypatch.setattr(reform_validation.httpx,'Client',lambda **kw:client)
    with pytest.raises(RuntimeError,match='never-started'):
        reform_validation.validate()
    assert seen==[('GET','/api/health')]
