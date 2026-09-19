import type { DemoRunSnapshot } from '@harness/contracts';
import { isTerminalRun } from './model';

export type Stage = 'brief' | 'method' | 'plan' | 'run' | 'review';

export const stageOrder: Stage[] = ['brief', 'method', 'plan', 'run', 'review'];

export const stageLabels: Record<Stage, string> = {
  brief: 'Brief',
  method: 'Method',
  plan: 'Plan',
  run: 'Work',
  review: 'Review',
};

export function currentStageFor(snapshot?: DemoRunSnapshot): Stage {
  if (!snapshot) return 'plan';
  return isTerminalRun(snapshot) ? 'review' : 'run';
}
