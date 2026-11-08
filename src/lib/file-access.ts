import 'server-only';
import type { SessionUser } from './auth';
import { deskCtx, loadVisibleTicket } from './desk-access';

/** Files on CRM records need CRM access; files on tickets follow ticket visibility. */
export async function canUseFilesOf(me: SessionUser, relatedType: string, relatedId: string) {
  if (relatedType === 'ticket') return me.deskRole !== 'none' && !!(await loadVisibleTicket(await deskCtx(me), relatedId));
  return me.crmAccess;
}
