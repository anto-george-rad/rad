import 'server-only';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';

import { DEFAULT_SETTINGS, type OrgSettings } from './settings-defaults';
export { DEFAULT_SETTINGS, type OrgSettings };
export async function getSettings(): Promise<OrgSettings> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, 'org') });
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<OrgSettings>) || {}) };
}
export async function saveSettings(patch: Partial<OrgSettings>) {
  const next = { ...(await getSettings()), ...patch };
  await db.insert(schema.settings).values({ key: 'org', value: next }).onConflictDoUpdate({ target: schema.settings.key, set: { value: next } });
  return next;
}


/** Integration credentials: kept in their own row, never sent to the browser. Secrets are sealed (AES-GCM). */
export type Integrations = {
  outlook?: { tenantId: string; clientId: string; clientSecret: string; lastError?: string | null; lastRunAt?: string | null };
  whatsapp?: { phoneNumberId: string; accessToken: string; verifyToken: string; appSecret: string; lastError?: string | null; lastInboundAt?: string | null };
};
export async function getIntegrations(): Promise<Integrations> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, 'integrations') });
  return (row?.value as Integrations) || {};
}
export async function saveIntegrations(patch: Partial<Integrations>) {
  const next = { ...(await getIntegrations()), ...patch };
  await db.insert(schema.settings).values({ key: 'integrations', value: next }).onConflictDoUpdate({ target: schema.settings.key, set: { value: next } });
  return next;
}
