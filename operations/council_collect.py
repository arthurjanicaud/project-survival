"""Shared free public research, kept separate from the council scheduler.

No orders, wallets, LLM calls or competition start. Sources retain fetch timestamps.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import time
import httpx
from dotenv import dotenv_values

ROOT=Path(__file__).resolve().parents[1]
def configuration():
    return {**dotenv_values(ROOT/'.env'),**os.environ}
def compact_espn(d):
    def competition(c):
        return {k:c[k] for k in ['id','date','status','competitors','notes','venue','format','type','situation'] if k in c}
    def competitor(c):
        return {k:c[k] for k in ['id','type','homeAway','team','athlete','records','curatedRank','statistics','score'] if k in c}
    events=[]
    for e in d.get('events',[]):
        cs=e.get('competitions',[])+[c for g in e.get('groupings',[]) for c in g.get('competitions',[])]
        for c in cs:
            x=competition(c);x['competitors']=[competitor(t) for t in c.get('competitors',[])]
            for t in x['competitors']:
                for key in ['team','athlete']:
                    if key in t:t[key]={k:v for k,v in t[key].items() if k in ['id','displayName','shortDisplayName','fullName','abbreviation']}
            names=[t.get('team',t.get('athlete',{})).get('displayName','') for t in x['competitors']]
            events.append({'id':e.get('id'),'name':' vs '.join(names) or e.get('name'),'date':c.get('date',e.get('date')),'status':c.get('status',e.get('status')),'competitions':[x],'links':e.get('links',[]),'season':e.get('season'),'tournament':e.get('shortName')})
    return {'events':events,'collector_method':'ESPN public scoreboard, compacted without invented values'}
def research(force=False):
    cfg=configuration();api=cfg['COUNCIL_API_URL'];headers={'Authorization':'Bearer '+cfg['COUNCIL_ADMIN_TOKEN']}
    health=httpx.get(api+'/api/health',timeout=30).json()
    test_response=httpx.get(api+'/api/health',params={'experiment':'test'},timeout=30)
    runs=[health]+([test_response.json()] if test_response.is_success else [])
    for stage in ['shadow','pilot','full']:
        response=httpx.get(api+'/api/health',params={'phase':'4','stage':stage},timeout=30)
        if response.is_success:runs.append(response.json())
    active=[r for r in runs if r.get('state',{}).get('status')=='RUNNING']
    demand_response=httpx.get(api+'/admin/research-demands',headers=headers,timeout=30);demand_response.raise_for_status()
    demands=demand_response.json().get('requests',[])
    if not active and not demands:
        print(json.dumps({'research':'inactive_experiment'}));return
    def recent(run):
        previous=run.get('research_collector',{}) or {}
        return previous.get('at') and (datetime.now(timezone.utc)-datetime.fromisoformat(previous['at'].replace('Z','+00:00'))).total_seconds()<600
    if not force and not demands and all(recent(run) for run in active):
        print(json.dumps({'research':'recent_shared_feed_reused'}));return
    leagues=['basketball/nba','basketball/wnba','soccer/eng.1','soccer/esp.1','soccer/ger.1','soccer/fra.1','soccer/ita.1','soccer/bra.1','soccer/usa.1','soccer/uefa.champions','soccer/uefa.wchampions','soccer/bra.2','tennis/atp','tennis/wta']
    today=datetime.now(timezone.utc).date()
    full=force or any(not r.get('research_collector',{} ) or not (r.get('research_collector') or {}).get('full_at') or datetime.fromisoformat(r['research_collector']['full_at'].replace('Z','+00:00')).date()!=today for r in active)
    urls=['https://api.opendota.com/api/teams'] if full or not all(recent(r) for r in active) else []
    for day in (range(-1,8) if full else [0,1] if not all(recent(r) for r in active) else []):
        stamp=(datetime.now(timezone.utc)+timedelta(days=day)).strftime('%Y%m%d')
        urls.extend(f'https://site.api.espn.com/apis/site/v2/sports/{league}/scoreboard?dates={stamp}' for league in leagues)
    from urllib.parse import urlparse
    dota=0
    for demand in sorted(demands,key=lambda d:d['at']):
        url=demand['url'];host=urlparse(url).hostname
        if host not in ['site.api.espn.com','api.opendota.com']:continue
        if host=='api.opendota.com' and '/matches' in url:
            if dota>=6:continue
            dota+=1
        urls.append(url)
    dota_times=[(r.get('research_collector') or {}).get('opendota_at') for r in runs]
    recent_dota=any(v and (datetime.now(timezone.utc)-datetime.fromisoformat(v.replace('Z','+00:00'))).total_seconds()<600 for v in dota_times)
    if recent_dota:urls=[u for u in urls if urlparse(u).hostname!='api.opendota.com']
    urls=list(dict.fromkeys(urls))
    results=[]
    with httpx.Client(timeout=40,follow_redirects=False) as client:
        def collect(url):
            r=client.get(url,headers={'User-Agent':'ProjectSurvival/3.0 public-research'});r.raise_for_status()
            data=r.json();fetched=datetime.now(timezone.utc).isoformat()
            if 'espn.com' in url:data=compact_espn(data)
            elif isinstance(data,list):
                fields=['match_id','radiant_win','radiant','opposing_team_id','opposing_team_name','start_time','duration','leagueid'] if '/matches' in url else ['team_id','name','rating','wins','losses','last_match_time']
                data=[{k:t.get(k) for k in fields} for t in (data[:10] if '/matches' in url else data)]
            out=client.post(api+'/admin/research',headers=headers,json={'url':url,'data':data,'fetched_at':fetched,'batch_kind':'full' if full else 'targeted'});out.raise_for_status()
            return {'url':url,'status':'OK','items':len(data.get('events',[])) if isinstance(data,dict) else len(data),'bytes':len(json.dumps(data))}
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures={pool.submit(collect,url):url for url in urls}
            for f in as_completed(futures):
                try:results.append(f.result())
                except Exception as e:results.append({'url':futures[f],'status':'ERROR','error':type(e).__name__})
    target=ROOT/'exports/phase3/research-latest.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'sources':results},indent=2),encoding='utf-8')
    ok=sum(r['status']=='OK' for r in results);print(json.dumps({'sources_ok':ok,'sources_failed':len(results)-ok,'bytes_sent':sum(r.get('bytes',0) for r in results)}))
    if ok==0:raise RuntimeError('No public research source available')
def notifications():
    cfg=configuration();api=cfg['COUNCIL_API_URL'];headers={'Authorization':'Bearer '+cfg['COUNCIL_ADMIN_TOKEN']}
    with httpx.Client(timeout=30) as client:
        out=client.get(api+'/admin/notification-outbox',headers=headers);out.raise_for_status();b=out.json();sent=0
        for n in b['notifications']:
            r=client.post('https://ntfy.sh',json={'topic':b['topic'],'title':n['title'],'message':n['message'],'priority':n['priority'],'click':n['url']})
            r.raise_for_status();ack=client.post(api+'/admin/notification-ack',headers=headers,params={'phase':'4','stage':n['stage']} if n.get('phase')==4 else {'instance':n['instance']} if n.get('instance') else {},json={'id':n['id']});ack.raise_for_status();sent+=1
            time.sleep(.3)
        print(json.dumps({'notifications_sent':sent}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('command',choices=['research','notifications']);p.add_argument('--force',action='store_true');a=p.parse_args();research(force=a.force) if a.command=='research' else notifications()
