import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FROM, createSmtpMailer, escapeHtml } from './mailer';

describe('SMTP mailer', () => {
  it('hands the message to nodemailer with the configured sender', async () => {
    // nodemailer's JSON transport builds the message without a server
    const mailer = createSmtpMailer({
      from: 'Ops <ops@example.test>',
      transport: { jsonTransport: true },
    });
    const spy = vi.spyOn(mailer.transporter, 'sendMail');
    await mailer.send({
      to: 'a@example.test',
      subject: 'Hello',
      text: 'plain',
      html: '<p>html</p>',
    });
    expect(spy).toHaveBeenCalledWith({
      from: 'Ops <ops@example.test>',
      to: 'a@example.test',
      subject: 'Hello',
      text: 'plain',
      html: '<p>html</p>',
    });
    const info = (await spy.mock.results[0]?.value) as { message: string };
    const built = JSON.parse(info.message) as { from: { address: string }; subject: string };
    expect(built).toMatchObject({ from: { address: 'ops@example.test' }, subject: 'Hello' });
  });

  it('uses the default sender when none is configured', async () => {
    const mailer = createSmtpMailer({ transport: { jsonTransport: true } });
    const spy = vi.spyOn(mailer.transporter, 'sendMail');
    await mailer.send({ to: 'a@example.test', subject: 's', text: 't', html: 'h' });
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ from: DEFAULT_FROM });
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
    );
  });
});
