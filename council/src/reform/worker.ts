import {DurableObject} from 'cloudflare:workers';
import type {Env} from '../domain';
import {ReformRuntime} from './runtime';
export class ReformCouncil extends DurableObject<Env>{
 private runtime:ReformRuntime;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.runtime=new ReformRuntime(ctx,env);}
 fetch(r:Request){return this.runtime.fetch(r);}
 alarm(){return this.runtime.alarm();}
}
