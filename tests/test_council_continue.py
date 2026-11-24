import json
import sqlite3

import pytest

from operations.council_continue import should_continue


@pytest.mark.parametrize('status,expected', [('READY', False), ('RUNNING', True), ('CLOSING', True), ('FINISHED', False)])
def test_only_active_official_fund_continues(tmp_path, status, expected):
    with sqlite3.connect(tmp_path/'active.sqlite') as db:
        db.execute('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)')
        db.execute('INSERT INTO meta VALUES(?,?)', ('reform_run', json.dumps({'id': 'survival-005-active', 'status': status})))
    assert should_continue(tmp_path, 'cycle') is expected
    assert should_continue(tmp_path, 'start') is expected
    assert not should_continue(tmp_path, 'smoke')
    assert not should_continue(tmp_path, 'initialize')


def test_missing_fund_never_starts_a_chain(tmp_path):
    assert not should_continue(tmp_path, 'cycle')
