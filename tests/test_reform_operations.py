from datetime import datetime, timezone
import gzip, hashlib, json
import pytest
from operations.reform_watchdog import inspect
from operations import reform_admin


def test_independent_watchdog_uses_progress_age_not_successful_http():
    at=datetime(2026,11,11,12,tzinfo=timezone.utc)
    assert inspect({'run':{'status':'READY'}},at) is None
    assert inspect({'run':{'status':'FINISHED'}},at) is None
    assert inspect({'run':{'status':'RUNNING','last_scan':'2026-11-11T11:59:00Z'}},at) is None
    assert inspect({'run':{'status':'RUNNING','last_scan':'2026-11-11T11:30:00Z'}},at)
    assert inspect({'run':{'status':'CLOSING'},'state':{'last_cycle':'2026-11-11T11:59:00Z'}},at) is None


def test_restore_rejects_overwrite_namespace_or_modified_backup_before_any_network(tmp_path):
    with pytest.raises(RuntimeError,match='separate'):
        reform_admin.restore(tmp_path,'survival-004-full','id')
    file=tmp_path/'ledger.ndjson.gz'
    with gzip.open(file,'wt') as f:f.write('{}\n')
    manifest={'stage':'shadow','state':{'run':{'id':'id'}},'tables':{'ledger':{'file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'rows':1}}}
    (tmp_path/'manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(RuntimeError,match='ID'):
        reform_admin.restore(tmp_path,'recovery-r4-test','other-id')
    file.write_bytes(b'corrupted')
    with pytest.raises(RuntimeError,match='SHA256'):
        reform_admin.restore(tmp_path,'recovery-r4-test','id')


def test_financial_and_vote_backups_include_exact_proposal_versions():
    assert 'proposals' in reform_admin.TABLES
    assert {'ledger','fills','positions','r4_forecasts','r4_outcomes'} <= set(reform_admin.TABLES)


def test_watchdog_does_not_report_planned_final_settlement_margin_as_a_research_outage():
    at=datetime(2026,11,11,12,tzinfo=timezone.utc)
    health={'run':{'status':'RUNNING','last_scan':'2026-11-11T06:00:00Z'},'state':{'betting_deadline':'2026-11-11T07:00:00Z','last_cycle':'2026-11-11T11:59:00Z'}}
    assert inspect(health,at) is None


def test_watchdog_allows_initial_scan_warmup_but_detects_a_launch_that_never_progresses():
    at=datetime(2026,11,11,12,tzinfo=timezone.utc)
    assert inspect({'run':{'status':'RUNNING','started_at':'2026-11-11T11:59:00Z'}},at) is None
    assert inspect({'run':{'status':'RUNNING','started_at':'2026-11-11T11:30:00Z'}},at)


def test_watchdog_distinguishes_deliberately_paced_research_from_an_unplanned_stall():
    at=datetime(2026,11,12,12,tzinfo=timezone.utc)
    h={'run':{'status':'RUNNING','last_scan':'2026-11-12T11:30:00Z'},'health':{'research_mode':'PACED'}}
    assert 'espacée' in inspect(h,at)
    h['run']['last_scan']='2026-11-12T10:30:00Z'
    assert '45 minutes' in inspect(h,at)
    assert inspect([],at)=='Réponse de santé illisible'

def test_watchdog_groups_storage_failure_and_sends_only_one_alert_then_one_recovery(tmp_path,monkeypatch):
    import httpx
    import operations.reform_watchdog as watch
    monkeypatch.setattr(watch,'ROOT',tmp_path)
    monkeypatch.setattr(watch,'dotenv_values',lambda path:{})
    monkeypatch.setenv('COUNCIL_API_URL','https://example.test')
    monkeypatch.setenv('COUNCIL_ADMIN_TOKEN','fixture-token')
    monkeypatch.setenv('COUNCIL_NTFY_TOPIC','fixture-topic')
    monkeypatch.setenv('GITHUB_OUTPUT',str(tmp_path/'outputs'))
    state={'blocked':True};sent=[]
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def get(self,url,**kwargs):
            payload={'error':'STORAGE_DAILY_QUOTA_EXCEEDED'} if state['blocked'] else {'run':{'status':'RUNNING','last_scan':datetime.now(timezone.utc).isoformat()}}
            return httpx.Response(503 if state['blocked'] else 200,json=payload,request=httpx.Request('GET',url))
        def post(self,url,**kwargs):
            assert url=='https://ntfy.sh','A known daily quota must not trigger futile engine calls'
            sent.append(kwargs['json']);return httpx.Response(200,json={},request=httpx.Request('POST',url))
    monkeypatch.setattr(watch.httpx,'Client',Client)
    watch.main();watch.main();assert len(sent)==1
    assert 'storage_blocked=true' in (tmp_path/'outputs').read_text()
    state['blocked']=False;watch.main();watch.main();assert len(sent)==2
    assert sent[-1]['title']=='Survival : recherche rétablie'
    assert 'storage_blocked=false' in (tmp_path/'outputs').read_text()
