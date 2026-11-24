import json,sqlite3
from operations.actions_council import needs_host

def fixture(tmp_path,status='READY'):
    for stage in ['full','shadow','pilot','active','smoke']:
        with sqlite3.connect(tmp_path/f'{stage}.sqlite')as db:
            db.executescript('CREATE TABLE meta(key TEXT,value TEXT); CREATE TABLE jobs(kind TEXT,status TEXT);')
            db.execute('INSERT INTO meta VALUES(?,?)',('reform_run',json.dumps({'status':status})))

def test_idle_does_not_spin_or_replay_jobs_in_finished_archives(tmp_path):
    fixture(tmp_path,'FINISHED')
    with sqlite3.connect(tmp_path/'full.sqlite')as db:db.execute("INSERT INTO jobs VALUES('R4_FORECAST','PENDING')")
    assert not needs_host(tmp_path)

def test_running_fund_or_explicit_ready_preflight_wakes_host(tmp_path):
    fixture(tmp_path)
    assert not needs_host(tmp_path)
    with sqlite3.connect(tmp_path/'pilot.sqlite')as db:db.execute("INSERT INTO jobs VALUES('R4_PREFLIGHT','PENDING')")
    assert needs_host(tmp_path)
    with sqlite3.connect(tmp_path/'pilot.sqlite')as db:
        db.execute('DELETE FROM jobs');db.execute("UPDATE meta SET value=?",(json.dumps({'status':'RUNNING'}),))
    assert needs_host(tmp_path)

def test_missing_state_is_an_error_not_a_new_empty_database(tmp_path):
    import pytest
    with pytest.raises(sqlite3.OperationalError):needs_host(tmp_path)
    assert not list(tmp_path.glob('*.sqlite'))


def test_normal_host_shutdown_does_not_emit_a_false_notification_outage(capsys):
    from operations.actions_council import service_pass
    class Host:
        done=False
        def poll(self):return 0 if self.done else None
    host=Host();calls=[]
    def research():
        calls.append('research');host.done=True
    def notifications():raise AssertionError('Must not contact a closed host')
    assert not service_pass(host,[research,notifications])
    assert calls==['research']
    assert capsys.readouterr().out==''
