import 'server-only';
import { db, schema } from '@/db';
import { asc, eq } from 'drizzle-orm';


export type { PipelineTreeT as PipelineTree } from './types';
import type { PipelineTreeT as PipelineTree } from './types';
export async function getPipelineTree(): Promise<PipelineTree[]> {
  const [ps, subs, sts] = await Promise.all([
    db.select().from(schema.pipelines).orderBy(asc(schema.pipelines.sortOrder)),
    db.select().from(schema.subPipelines).orderBy(asc(schema.subPipelines.sortOrder)),
    db.select().from(schema.stages).orderBy(asc(schema.stages.sortOrder)),
  ]);
  return ps.map((p) => ({ ...p, subs: subs.filter((s) => s.pipelineId === p.id).map((s) => ({ ...s, stages: sts.filter((x) => x.subPipelineId === s.id) })) }));
}
export async function getUsers() {
  return db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, active: schema.users.active, managerId: schema.users.managerId }).from(schema.users).orderBy(asc(schema.users.name));
}
export async function getCustomFields(module?: string) {
  const rows = await db.select().from(schema.customFields).orderBy(asc(schema.customFields.sortOrder));
  return module ? rows.filter((r) => r.module === module) : rows;
}
export async function getScoringRules() { return db.select().from(schema.scoringRules); }
export async function getStage(id: string) { return db.query.stages.findFirst({ where: eq(schema.stages.id, id) }); }
