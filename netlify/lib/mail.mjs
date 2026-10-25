import { env } from './http.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const emailConfigured = () => Boolean(env('RESEND_API_KEY') && env('LEAD_NOTIFY_EMAIL'));

export async function sendLeadEmail(lead, siteUrl) {
  if (!emailConfigured()) return false;
  const rows = [
    ['Name', lead.name],
    ['Email', lead.email],
    ['Phone', lead.phone],
    ['Message', lead.message],
    ['Post', lead.postTitle],
    ['Page', lead.pageUrl],
    ['Source', [lead.utm?.utm_source, lead.utm?.utm_medium, lead.utm?.utm_campaign].filter(Boolean).join(' / ')],
  ].filter(([, v]) => v);
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (siteUrl ? `\n\nAll leads: ${siteUrl}/admin/` : '');
  const html = `<table style="font:15px/1.5 system-ui,sans-serif">${rows
    .map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:#566074;vertical-align:top">${esc(k)}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
    .join('')}</table>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env('LEAD_FROM_EMAIL') || 'Blog leads <onboarding@resend.dev>',
        to: env('LEAD_NOTIFY_EMAIL').split(',').map((s) => s.trim()).filter(Boolean),
        reply_to: lead.email,
        subject: `New lead: ${lead.name}${lead.postTitle ? ` (${lead.postTitle})` : ''}`.slice(0, 200),
        text,
        html,
      }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
