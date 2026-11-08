import 'server-only';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

/** Attachments live on disk under UPLOAD_DIR (a Docker volume in production). */
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
export const MAX_UPLOAD = 15 * 1024 * 1024;
const safeKey = (k: string) => { if (!/^[a-f0-9-]{36}$/.test(k)) throw new Error('bad key'); return path.join(UPLOAD_DIR, k); };
export async function store(buf: Buffer) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const key = randomUUID(); await writeFile(safeKey(key), buf); return key;
}
export const readStored = (key: string) => readFile(safeKey(key));
export async function removeStored(key: string) { try { await unlink(safeKey(key)); } catch { /* already gone */ } }
