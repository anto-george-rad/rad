import 'server-only';
import nodemailer from 'nodemailer';
import { log } from './log';

/** Email is optional. With SMTP_HOST set, mail is sent; otherwise callers fall back to in-app flows. */
export const mailEnabled = () => !!process.env.SMTP_HOST;
export async function sendMail(to: string, subject: string, text: string, html?: string, attachments?: { filename: string; content: Buffer; contentType?: string }[]) {
  if (!mailEnabled()) return false;
  try {
    const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, ...(html ? { html } : {}), ...(attachments?.length ? { attachments } : {}) });
    return true;
  } catch (e) { log.error('mail_failed', { to, subject, error: String(e) }); return false; }
}
