import {z} from 'zod';
export const ResidualRowSchema=z.object({station:z.string().regex(/^[A-Z]{4}$/),model:z.string().min(2).max(80),forecast_issued_at:z.iso.datetime({offset:true}),valid_day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),lead_hours:z.number().min(0).max(240),forecast_c:z.number().min(-90).max(70),observed_c:z.number().min(-90).max(70),observed_at:z.iso.datetime({offset:true}),forecast_source:z.url(),observation_source:z.url(),observation_kind:z.literal('station-observation')}).strict();
export type ResidualRow=z.infer<typeof ResidualRowSchema>;
export function fitResiduals(rows:ResidualRow[],station:string,leadHours:number,cutoff:string,modelName=rows[0]?.model){
  const selected=rows.map(r=>ResidualRowSchema.parse(r)).filter(r=>r.station===station&&r.model===modelName&&Math.floor(r.lead_hours/24)===Math.floor(leadHours/24)&&r.observed_at<=cutoff&&r.forecast_issued_at<r.observed_at&&r.valid_day<cutoff.slice(0,10));
  const unique=[...new Map(selected.map(r=>[r.station+':'+r.valid_day,r])).values()];
  return {method:'weather-residual-v1',station,lead_bucket:Math.floor(leadHours/24),cutoff,n:unique.length,residuals_c:unique.map(r=>r.observed_c-r.forecast_c),manifest:unique.map(r=>({issued:r.forecast_issued_at,observed:r.observed_at,forecast_source:r.forecast_source,observation_source:r.observation_source,model:r.model,day:r.valid_day})),limitation:'A fitted residual distribution still requires prospective held-out validation; reanalysis is not a forecast archive.'};
}
export function residualProbability(model:ReturnType<typeof fitResiduals>,forecastC:number,lowerC:number|null,upperC:number|null){
  if(model.n<30)return {probability:null,lower:null,upper:null,reason:'Insufficient distinct historical station days'};
  const hits=model.residuals_c.filter(r=>(lowerC===null||forecastC+r>=lowerC)&&(upperC===null||forecastC+r<upperC)).length;
  const probability=(hits+1)/(model.n+2),interval=wilson(hits,model.n);
  return {probability,lower:Math.min(interval.lower,probability),upper:Math.max(interval.upper,probability),reason:'Smoothed empirical station residuals; uncertainty and common model errors remain.'};
}
export function wilson(successes:number,n:number){
  if(!n)return {lower:0,upper:1};const z=1.96,p=successes/n,den=1+z*z/n,centre=(p+z*z/(2*n))/den,width=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;return {lower:Math.max(0,centre-width),upper:Math.min(1,centre+width)};
}
