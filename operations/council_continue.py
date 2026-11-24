"""Keep an active funded week moving even when GitHub cron is delayed."""
import json
import os
import sqlite3
from pathlib import Path

import httpx


def should_continue(directory, action):
    if action not in ('cycle', 'start'):
        return False
    path = Path(directory) / 'active.sqlite'
    if not path.exists():
        return False
    with sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True) as db:
        row = db.execute("SELECT value FROM meta WHERE key='reform_run'").fetchone()
    run = json.loads(row[0]) if row else {}
    return run.get('id') == 'survival-005-active' and run.get('status') in ('RUNNING', 'CLOSING')


def main():
    if not should_continue(os.environ['COUNCIL_DATA_DIR'], os.environ.get('COUNCIL_ACTION', 'cycle')):
        print(json.dumps({'continuation': 'no_active_official_fund'}))
        return
    url = 'https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY'] + '/actions/workflows/council-actions.yml/dispatches'
    response = httpx.post(url, headers={'Authorization': 'Bearer '+os.environ['GH_TOKEN'],
                                      'Accept': 'application/vnd.github+json'},
                          json={'ref': 'main', 'inputs': {'action': 'cycle', 'preflight': False}}, timeout=30)
    response.raise_for_status()
    print(json.dumps({'continuation': 'next_cycle_dispatched', 'status': response.status_code}))


if __name__ == '__main__':
    main()
