import {D} from '../finance';
import Decimal from 'decimal.js';
import type {Policy} from './policy';
export function allowance(input:{initial:string;cash:string;spent:string;clusterCost:string;elapsedFraction:number;probability:number;lower:number;price:string;feePerShare:string;methodQualified:boolean},p:Policy){
  const initial=D(input.initial),cash=D(input.cash),unit=D(input.price).plus(input.feePerShare);
  const reserve=initial.mul(p.reserveFraction),released=initial.mul(p.initialReleaseFraction+(1-p.initialReleaseFraction)*Math.min(1,Math.max(0,input.elapsedFraction)));
  const conservative=input.lower,kelly=unit.gte(1)?D(0):D(conservative).minus(unit).div(D(1).minus(unit)).mul(p.kellyFraction).mul(initial);
  const limits=[cash.minus(reserve),released.minus(input.spent),initial.mul(p.betFraction),initial.mul(p.clusterFraction).minus(input.clusterCost),kelly];
  const max=limits.reduce((a,b)=>a.lt(b)?a:b);return {maximum:Decimal.max(0,input.methodQualified?max:'0').toDecimalPlaces(5,Decimal.ROUND_DOWN).toFixed(),reserve:reserve.toFixed(),released:released.toFixed(),kelly:Decimal.max(0,kelly).toFixed(),reason:!input.methodQualified?'Méthode non validée : observation sans mise':max.lte(0)?'Pas d’enveloppe disponible sous ce protocole':'Enveloppe de recherche, réserve et risque commun contrôlés',limits:limits.map(x=>x.toFixed())};
}
