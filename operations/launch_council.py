"""Explicit phase-5 initialization, real Azure council test, and one-time START."""
import json
import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from operations.actions_council import ROOT, needs_host, service_pass
from operations.council_collect import notifications, research


def main():
    env = {**os.environ, 'COUNCIL_API_URL': 'http://127.0.0.1:8790'}
    os.environ['COUNCIL_API_URL'] = env['COUNCIL_API_URL']
    env['COUNCIL_CODE_VERSION'] = subprocess.check_output(
        ['git', 'rev-parse', 'HEAD:council/src'], cwd=ROOT, text=True).strip()
    action = env.get('COUNCIL_ACTION', 'cycle')
    scope = env.get('COUNCIL_PREFLIGHT_SCOPE', 'pilot')
    preflight = env.get('COUNCIL_PREFLIGHT') == 'true' or action in ['initialize', 'smoke', 'start']
    if not preflight and not needs_host(env['COUNCIL_DATA_DIR']):
        print(json.dumps({'council': 'idle_no_active_fund', 'no_start': True, 'azure_calls': 0}), flush=True)
        return
    process = subprocess.Popen(['node', '--import', 'tsx', 'src/node/host.ts'], cwd=ROOT/'council', env=env)
    stop = threading.Event()
    notifier = None

    def deliver():
        while not stop.is_set() and process.poll() is None:
            try:
                notifications()
            except Exception as error:
                if process.poll() is None:
                    print(json.dumps({'service': 'notifications', 'error': str(error)}), flush=True)
            stop.wait(5)

    try:
        with httpx.Client(timeout=120, headers={'Authorization': 'Bearer '+env['COUNCIL_ADMIN_TOKEN']}) as client:
            def get(path, stage=scope):
                response = client.get(env['COUNCIL_API_URL']+path, params={'stage': stage})
                response.raise_for_status()
                return response.json()

            def post(path, stage=scope, body=None):
                response = client.post(env['COUNCIL_API_URL']+path, params={'stage': stage}, json=body or {})
                if response.status_code == 409:
                    return None
                response.raise_for_status()
                return response.json()

            for _ in range(90):
                if process.poll() is not None:
                    raise RuntimeError('Council host stopped before initialization')
                try:
                    get('/api/health')
                    break
                except httpx.HTTPError:
                    time.sleep(1)
            else:
                raise RuntimeError('Council host initialization timeout')
            notifier = threading.Thread(target=deliver, daemon=True)
            notifier.start()
            requested_at = datetime.now(timezone.utc)
            attempts = 1
            action_done = False
            stop_requested = False
            if preflight:
                post('/admin/preflight')
            last_collect = 0
            while process.poll() is None:
                if time.monotonic()-last_collect > 45:
                    if not service_pass(process, [research]):
                        break
                    last_collect = time.monotonic()
                try:
                    ready = get('/admin/readiness')
                    launch = get('/admin/launch-health')
                except httpx.HTTPError:
                    if process.poll() is None:
                        raise
                    break
                domains = ready['domains']
                complete = len(domains) == 5 and all(
                    item.get('checked_at') and datetime.fromisoformat(item['checked_at'].replace('Z', '+00:00')) >= requested_at
                    for item in domains)
                if preflight and complete and not ready['ready'] and attempts < 4 and time.monotonic()-last_collect < 5:
                    requested_at = datetime.now(timezone.utc)
                    post('/admin/preflight')
                    attempts += 1
                if preflight and complete and ready['ready']:
                    if action == 'smoke' and not action_done:
                        action_done = post('/admin/smoke', 'smoke') is not None
                    elif action == 'start' and not action_done:
                        result = post('/admin/start', 'active', {'confirm': env.get('COUNCIL_START_CONFIRM', '')})
                        if result is not None:
                            action_done = True
                            print(json.dumps({'official_start': result}), flush=True)
                    elif action in ['initialize', 'cycle']:
                        action_done = True
                done = action_done and (action != 'smoke' or (launch.get('smoke') or {}).get('passed', False))
                if done and not stop_requested:
                    stop_requested = post('/admin/stop-runner') is not None
                time.sleep(2)
            process.wait(timeout=30)
            if process.returncode:
                raise RuntimeError('Council host failed; last durable checkpoint is retained')
            report = Path(env['COUNCIL_DATA_DIR'])/'validation.json'
            result = json.loads(report.read_text()) if report.exists() else {}
            print(json.dumps(result), flush=True)
            if preflight and not result.get('readiness', {}).get('ready'):
                raise RuntimeError('Real-provider preflight incomplete')
            if action == 'smoke' and not (result.get('launch', {}).get('smoke') or {}).get('passed'):
                raise RuntimeError('Real Azure council test incomplete; see isolated report')
            if action == 'start' and result.get('launch', {}).get('active', {}).get('status') != 'RUNNING':
                raise RuntimeError('Official competition was not started')
    finally:
        stop.set()
        if notifier:
            notifier.join(timeout=35)
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=30)


if __name__ == '__main__':
    main()
