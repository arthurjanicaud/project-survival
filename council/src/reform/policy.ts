import {z} from 'zod';
export const PolicySchema=z.object({
  version:z.enum(['survival-reform-1','survival-active-1']),durationHours:z.number().int().min(24).max(720),
  maximumSlippageTicks:z.number().int().min(0).max(5).default(2),
  requireQualification:z.boolean().default(true),unvalidatedBetFraction:z.number().positive().max(.05).default(.025),minimumEstimatedEdge:z.number().min(0).max(.2).default(.02),
  shadowMinimumHours:z.number().min(24),pilotCapitalEur:z.string().regex(/^\d+(\.\d+)?$/),fullCapitalEur:z.string().regex(/^\d+(\.\d+)?$/),
  minimumResolvedEvents:z.number().int().min(20),minimumMethodEvents:z.number().int().min(10),
  reserveFraction:z.number().min(0).max(.9),betFraction:z.number().positive().max(.25),clusterFraction:z.number().positive().max(.5),
  initialReleaseFraction:z.number().positive().max(1),kellyFraction:z.number().positive().max(1),
  minimumCoverage:z.number().min(.8).max(1),maximumCalibrationError:z.number().positive().max(.3),
  scanMinutes:z.number().int().min(5),maximumDataAgeSeconds:z.number().int().positive(),maximumObservationAgeSeconds:z.number().int().positive(),
  maximumScanCandidates:z.number().int().min(1).max(20),meetingHours:z.array(z.number().int().min(0).max(23)),
  maximumMeetingSeconds:z.number().int().min(60).max(600),maximumContextChars:z.number().int().min(8000).max(26000),
  staleScanMinutes:z.number().int().min(10),sourceFamiliesRequired:z.number().int().min(1).max(5),
  settlementMarginHours:z.number().int().min(6),archiveDays:z.number().int().min(7),
  freeRowsReadDaily:z.number().int().positive(),freeRowsWrittenDaily:z.number().int().positive(),freeRequestsDaily:z.number().int().positive(),
}).strict();
// These are experiment parameters, not claims about an optimal betting policy.
export const POLICY=PolicySchema.parse({version:'survival-reform-1',durationHours:168,shadowMinimumHours:48,
  pilotCapitalEur:'100',fullCapitalEur:'1000',minimumResolvedEvents:100,minimumMethodEvents:30,
  reserveFraction:.2,betFraction:.05,clusterFraction:.2,initialReleaseFraction:.2,kellyFraction:.25,
  minimumCoverage:.95,maximumCalibrationError:.1,scanMinutes:10,maximumDataAgeSeconds:900,maximumObservationAgeSeconds:3600,
  maximumScanCandidates:3,meetingHours:[9,13,17,21],maximumMeetingSeconds:600,maximumContextChars:26000,
  staleScanMinutes:20,sourceFamiliesRequired:1,settlementMarginHours:6,archiveDays:14,
  freeRowsReadDaily:5_000_000,freeRowsWrittenDaily:100_000,freeRequestsDaily:100_000});
export type Policy=z.infer<typeof PolicySchema>;

export const ACTIVE_POLICY=PolicySchema.parse({...POLICY,version:'survival-active-1',requireQualification:false,initialReleaseFraction:1,unvalidatedBetFraction:.025});
export function policyFor(stage:string,active:boolean){return stage==='FULL'&&active?ACTIVE_POLICY:POLICY;}
