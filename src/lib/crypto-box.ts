import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
/** Encrypts small secrets at rest (mailbox passwords, 2FA secrets) with a key derived from AUTH_SECRET. */
const key = () => createHash('sha256').update('rad-box:' + (process.env.AUTH_SECRET || 'dev-only-secret-not-for-production-use')).digest();
export function seal(plain: string) {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
export function open(sealed: string) {
  const [v, iv, tag, data] = sealed.split('.'); if (v !== 'v1') throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
