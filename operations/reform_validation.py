"""Real-provider readiness checks on an unfunded READY object. Never calls START or Azure."""
import argparse,json,time
from datetime import datetime,timezone
from pathlib import Path
from operations.reform_admin import configuration
import httpx

def validate(stage='pilot',timeout_seconds=420):
    cfg=configuration();params={'phase':'4','stage':stage};headers={'Authorization':'Bearer '+cfg['COUNCIL_ADMIN_TOKEN']};deadline=time.monotonic()+timeout_seconds
    with httpx.Client(timeout=60,headers=headers) as client:
        def get(path):
            r=client.get(cfg['COUNCIL_API_URL']+path,params=params);r.raise_for_status();return r.json()
        health=get('/api/health')
        if health.get('run',{}).get('status')!='READY' or health.get('state',{}).get('started_at'):raise RuntimeError('Validation requires an unfunded, never-started READY object')
        baseline=get('/admin/integrity')
        if baseline['counts']['ledger'] or baseline['counts']['positions']:raise RuntimeError('Validation cannot touch a funded object')
        next_collect=0
        for attempt in range(5):
            started=datetime.now(timezone.utc)
            r=client.post(cfg['COUNCIL_API_URL']+'/admin/preflight',params=params,json={});r.raise_for_status()
            while time.monotonic()<deadline:
                time.sleep(10)
                checks=get('/admin/readiness')['domains']
                # Shared source demands are public data only, not reasoning jobs.
                from operations.council_collect import research
                if time.monotonic()>=next_collect:
                    research();next_collect=time.monotonic()+60
                if len(checks)==5 and all(c.get('checked_at') and datetime.fromisoformat(c['checked_at'].replace('Z','+00:00'))>=started for c in checks):break
            ready=get('/admin/readiness')
            if all(d['ready'] for d in ready['domains']):break
            if time.monotonic()>=deadline:break
            research()  # Resolve demands created by the last source job before retrying.
        after=get('/admin/integrity')
        if after['financial_sha256']!=baseline['financial_sha256']:raise RuntimeError('Validation changed fund integrity')
        return {'at':datetime.now(timezone.utc).isoformat(),'mode':'read-only-provider-validation','no_start':True,'azure_calls':0,'financial_integrity_unchanged':True,'readiness':ready,'preflight':get('/api/state').get('preflight',{})}

def main():
    p=argparse.ArgumentParser();p.add_argument('--stage',choices=['pilot','shadow'],default='pilot');p.add_argument('--output',default='output/validation/latest.json');a=p.parse_args()
    try:result=validate(a.stage)
    except Exception as e:
        path=Path(a.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'error':str(e),'no_start':True,'azure_calls':0},indent=2),encoding='utf-8');raise
    path=Path(a.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='preflight'},ensure_ascii=True))
    if not all(d['ready'] for d in result['readiness']['domains']):raise SystemExit(1)
if __name__=='__main__':main()
