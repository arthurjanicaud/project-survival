"""Run the shared council against restored SQLite, never START automatically."""
import os,subprocess,time,json
from pathlib import Path
import httpx
from operations.council_collect import research,notifications
ROOT=Path(__file__).resolve().parents[1]
def main():
    env={**os.environ,'COUNCIL_API_URL':'http://127.0.0.1:8790'}
    os.environ['COUNCIL_API_URL']=env['COUNCIL_API_URL']
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
            if os.environ.get('COUNCIL_PREFLIGHT')=='true':
                r=client.post(env['COUNCIL_API_URL']+'/admin/preflight',params={'stage':'pilot'});r.raise_for_status()
            last_collect=0;last_ready=None
            while p.poll() is None:
                if time.monotonic()-last_collect>60:
                    for f in [research,notifications]:
                        try:f()
                        except Exception as e:print(json.dumps({'service':f.__name__,'error':str(e)}),flush=True)
                    try:
                        r=client.get(env['COUNCIL_API_URL']+'/admin/readiness',params={'stage':'pilot'})
                        if r.is_success:last_ready=r.json()
                    except httpx.HTTPError:
                        if p.poll() is None:raise
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
