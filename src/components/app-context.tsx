'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { CustomField, DeskRole, EmailTemplate, Product, RolePermissions, TicketScope, TicketStatus } from '@/db/schema';
import type { OrgSettings } from '@/lib/settings-defaults';
import type { PipelineTreeT } from '@/lib/types';

export type DeskAgent = { id: string; name: string; deskRole: DeskRole; deptIds: string[]; teamIds: string[]; available: boolean; active: boolean };
export type Lookups = {
  me: { id: string; name: string; email: string; role: 'admin' | 'manager' | 'rep'; theme: string; crmAccess: boolean; deskRole: DeskRole; ticketScope: TicketScope; deskAvailable: boolean; perms: RolePermissions; customRole: string | null };
  users: { id: string; name: string; email: string; role: string; active: boolean; managerId: string | null }[];
  pipelines: PipelineTreeT[];
  products: Product[];
  customFields: CustomField[];
  templates: EmailTemplate[];
  settings: OrgSettings;
  aiEnabled: boolean;
  favorites: { recordType: string; recordId: string; label: string }[];
  /** Ids of people whose tasks this user may see; null = everyone (admins). */
  team: string[] | null;
  /** Helpdesk setup, only for people with a desk role. */
  desk: null | { departments: { id: string; name: string; active: boolean }[]; teams: { id: string; departmentId: string; name: string }[]; statuses: TicketStatus[]; agents: DeskAgent[]; myDeptIds: string[]; myTeamIds: string[] };
};
const Ctx = createContext<Lookups | null>(null);
export function AppProvider({ value, children }: { value: Lookups; children: ReactNode }) { return <Ctx.Provider value={value}>{children}</Ctx.Provider>; }
export function useApp() { const v = useContext(Ctx); if (!v) throw new Error('useApp outside provider'); return v; }
export function useUserName() {
  const { users, me } = useApp();
  return (id?: string | null) => !id ? 'Unassigned' : id === me.id ? 'You' : users.find((u) => u.id === id)?.name || 'Former user';
}
export function useStage() {
  const { pipelines } = useApp();
  return (stageId?: string | null) => {
    for (const p of pipelines) for (const s of p.subs) { const st = s.stages.find((x) => x.id === stageId); if (st) return { ...st, pipeline: p, sub: s }; }
    return undefined;
  };
}
