"""Run the shared council against restored SQLite, never START automatically."""
import os,subprocess,time,json,sqlite3
from pathlib import Path
from datetime import datetime,timezone
import httpx
from operations.council_collect import research,notifications
ROOT=Path(__file__).resolve().parents[1]
def needs_host(directory):
    for stage in ['full','shadow','pilot']:
        path=Path(directory)/f'{stage}.sqlite'
        with sqlite3.connect(f'file:{path.as_posix()}?mode=ro',uri=True) as db:
            row=db.execute("SELECT value FROM meta WHERE key='reform_run'").fetchone()
            if not row:raise RuntimeError('Missing run; refuse empty fund')
            run=json.loads(row[0])
            if run.get('stopped_at') or run['status']=='FINISHED':continue
            if run['status'] in ['RUNNING','CLOSING']:return True
            if db.execute("SELECT 1 FROM jobs WHERE kind='R4_PREFLIGHT' AND status IN ('PENDING','RUNNING') LIMIT 1").fetchone():return True
    return False

def service_pass(process,services):
    for service in services:
        if process.poll() is not None:return False
        try:service()
        except Exception as e:
            if process.poll() is None:print(json.dumps({'service':service.__name__,'error':str(e)}),flush=True)
    return process.poll() is None

def main():
    env={**os.environ,'COUNCIL_API_URL':'http://127.0.0.1:8790'}
    os.environ['COUNCIL_API_URL']=env['COUNCIL_API_URL']
    # Documentation/frontend commits must not freeze a running council.
    env['COUNCIL_CODE_VERSION']=subprocess.check_output(['git','rev-parse','HEAD:council/src'],cwd=ROOT,text=True).strip()
    if env.get('COUNCIL_PREFLIGHT')!='true' and not needs_host(env['COUNCIL_DATA_DIR']):
        print(json.dumps({'council':'idle_no_active_fund','no_start':True,'azure_calls':0}),flush=True);return
    p=subprocess.Popen(['node','--import','tsx','src/node/host.ts'],cwd=ROOT/'council',env=env)
    headers={'Authorization':'Bearer '+env['COUNCIL_ADMIN_TOKEN']}
    try:
        with httpx.Client(timeout=30,headers=headers) as client:
            for _ in range(90):
                if p.poll() is not None:raise RuntimeError('Council host stopped before initialization')
                try:
                    r=client.get(env['COUNCIL_API_URL']+'/api/health');r.raise_for_status();break
                except httpx.HTTPError:time.sleep(1)
            else:raise RuntimeError('Council host initialization timeout')
            requested_at=datetime.now(timezone.utc);attempts=1
            if os.environ.get('COUNCIL_PREFLIGHT')=='true':
                r=client.post(env['COUNCIL_API_URL']+'/admin/preflight',params={'stage':'pilot'});r.raise_for_status()
            last_collect=0;last_ready=None
            while p.poll() is None:
                if time.monotonic()-last_collect>60:
                    if not service_pass(p,[research,notifications]):break
                    try:
                        r=client.get(env['COUNCIL_API_URL']+'/admin/readiness',params={'stage':'pilot'})
                        if r.is_success:last_ready=r.json()
                    except httpx.HTTPError:
                        if p.poll() is None:raise
                    if env.get('COUNCIL_PREFLIGHT')=='true' and last_ready and attempts<4:
                        domains=last_ready['domains']
                        complete=len(domains)==5 and all(d.get('checked_at') and datetime.fromisoformat(d['checked_at'].replace('Z','+00:00'))>=requested_at for d in domains)
                        if complete and not all(d['ready'] for d in domains) and p.poll() is None:
                            requested_at=datetime.now(timezone.utc)
                            r=client.post(env['COUNCIL_API_URL']+'/admin/preflight',params={'stage':'pilot'});r.raise_for_status();attempts+=1
                    last_collect=time.monotonic()
                time.sleep(1)
            if p.returncode:raise RuntimeError('Council host failed; last durable checkpoint is retained')
            report=Path(env['COUNCIL_DATA_DIR'])/'validation.json'
            if report.exists():last_ready=json.loads(report.read_text())['readiness']
            if os.environ.get('COUNCIL_PREFLIGHT')=='true':
                print(json.dumps({'preflight':last_ready,'no_start':True}))
                if not last_ready or not all(d['ready'] for d in last_ready['domains']):raise RuntimeError('Some real provider dossiers are unavailable; see published preflight')
    finally:
        if p.poll() is None:p.terminate();p.wait(timeout=30)
if __name__=='__main__':main()
