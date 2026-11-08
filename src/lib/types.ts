import type { Pipeline, Stage, SubPipeline } from '@/db/schema';
export type PipelineTreeT = Pipeline & { subs: (SubPipeline & { stages: Stage[] })[] };
