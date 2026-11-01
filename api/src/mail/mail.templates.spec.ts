import { describe, expect, it } from 'vitest';
import { resetPasswordTemplate, verifyEmailTemplate } from './mail.templates.js';

describe('mail templates', () => {
  it('includes the link in both html and text', () => {
    const t = verifyEmailTemplate('Ada', 'https://app/verify-email?token=abc');
    expect(t.html).toContain('https://app/verify-email?token=abc');
    expect(t.text).toContain('https://app/verify-email?token=abc');
  });

  it('escapes user-controlled names', () => {
    const t = resetPasswordTemplate('<script>x</script>', 'https://app/r');
    expect(t.html).not.toContain('<script>');
    expect(t.html).toContain('&lt;script&gt;');
  });
});
