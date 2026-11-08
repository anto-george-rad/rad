import type { Metadata } from 'next';
import { cookies } from 'next/headers';
// Fonts are self-hosted (no calls to Google at runtime): Manrope for headings, Inter for text, JetBrains Mono for numbers.
import '@fontsource-variable/manrope';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './globals.css';
import { getSettings } from '@/lib/settings';
import { brandCss } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  let org = 'Raidefend';
  try { org = (await getSettings()).orgName || org; } catch { /* database not ready */ }
  return { title: { default: 'RAD Workspace', template: '%s · RAD Workspace' }, description: `${org} workspace: CRM and helpdesk`, applicationName: 'RAD Workspace', icons: { icon: '/api/brand/icon' }, manifest: '/manifest.webmanifest' };
}
// The server sets data-theme from the user's saved choice (cookie); localStorage only fills in before sign-in.
const themeScript = `try{if(!document.documentElement.getAttribute('data-theme')){var t=localStorage.getItem('rd-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pref = cookies().get('rd-theme')?.value;
  let css = '';
  try { css = brandCss((await getSettings()).brandColor); } catch { /* database not ready */ }
  return (
    <html lang="en" suppressHydrationWarning data-theme={pref === 'light' || pref === 'dark' ? pref : undefined}>
      <head>
        {css && <style id="brand" dangerouslySetInnerHTML={{ __html: css }} />}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
