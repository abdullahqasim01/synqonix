const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(title: string, body: string, cta: { label: string; url: string }) {
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f4f4f5;padding:24px">
<div style="max-width:480px;margin:auto;background:#fff;border-radius:8px;padding:24px">
<h2 style="margin-top:0">${esc(title)}</h2>
<p>${body}</p>
<p><a href="${esc(cta.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(cta.label)}</a></p>
<p style="color:#71717a;font-size:12px">If the button does not work, open this link:<br>${esc(cta.url)}</p>
</div></body></html>`;
  const text = `${title}\n\n${body.replace(/<[^>]+>/g, '')}\n\n${cta.label}: ${cta.url}\n`;
  return { html, text };
}

export const verifyEmailTemplate = (name: string, url: string) => ({
  subject: 'Verify your Synqonix email',
  ...layout('Verify your email', `Hi ${esc(name)}, confirm your email address to finish setting up Synqonix. The link expires in 24 hours.`, { label: 'Verify email', url }),
});

export const resetPasswordTemplate = (name: string, url: string) => ({
  subject: 'Reset your Synqonix password',
  ...layout('Reset your password', `Hi ${esc(name)}, we received a request to reset your password. The link expires in 1 hour. If this was not you, ignore this email.`, { label: 'Reset password', url }),
});

export const inviteTemplate = (inviter: string, workspace: string, url: string) => ({
  subject: `${inviter} invited you to ${workspace} on Synqonix`,
  ...layout(`Join ${esc(workspace)}`, `${esc(inviter)} invited you to collaborate on Synqonix.`, { label: 'Accept invitation', url }),
});

export interface NotificationMailItem { title: string; body?: string | null; url: string }

/** One email for one or several notifications; several are shown as a list. */
export function notificationTemplate(items: NotificationMailItem[], webUrl: string) {
  const link = (i: NotificationMailItem) => `${webUrl}${i.url}`;
  if (items.length === 1) {
    const [i] = items;
    return { subject: i.title, ...layout(i.title, i.body ? esc(i.body) : 'Open Synqonix to see the details.', { label: 'Open in Synqonix', url: link(i) }) };
  }
  const list = items
    .map((i) => `<li style="margin-bottom:8px"><a href="${esc(link(i))}" style="color:#4f46e5">${esc(i.title)}</a>${i.body ? `<br><span style="color:#52525b">${esc(i.body)}</span>` : ''}</li>`)
    .join('');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f4f4f5;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:8px;padding:24px">
<h2 style="margin-top:0">${items.length} new notifications</h2>
<ul style="padding-left:18px">${list}</ul>
<p><a href="${esc(webUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open Synqonix</a></p>
<p style="color:#71717a;font-size:12px">You can change what you get by email in your notification settings.</p>
</div></body></html>`;
  const text = `${items.length} new notifications\n\n${items.map((i) => `- ${i.title}${i.body ? `\n  ${i.body}` : ''}\n  ${link(i)}`).join('\n')}\n`;
  return { subject: `${items.length} new notifications on Synqonix`, html, text };
}
