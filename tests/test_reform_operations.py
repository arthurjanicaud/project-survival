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
