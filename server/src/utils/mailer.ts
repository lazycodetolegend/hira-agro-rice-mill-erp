import nodemailer from 'nodemailer';
import { decryptSensitiveText } from './crypto.js';

export interface EmailSendRequest {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type TestEmailSender = (req: EmailSendRequest) => Promise<void>;
let customEmailSender: TestEmailSender | null = null;

export function setEmailOtpSenderForTest(fn: TestEmailSender | null) {
  customEmailSender = fn;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export interface ResolvedMailConfig {
  mode: 'RESEND' | 'SMTP' | 'TEST' | 'NONE';
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from?: string;
  resendKey?: string;
}

export function resolveMailConfig(business: any): ResolvedMailConfig {
  if (customEmailSender) {
    return { mode: 'TEST', from: 'test@hiraagro.local' };
  }
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    return {
      mode: 'RESEND',
      resendKey,
      from: process.env.SMTP_FROM?.trim() || 'Hira Agro ERP <onboarding@resend.dev>',
    };
  }

  const envUser = process.env.SMTP_USER?.trim();
  const envPass = process.env.SMTP_PASS?.trim();
  if (envUser && envPass) {
    return {
      mode: 'SMTP',
      host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      user: envUser,
      pass: envPass,
      from: process.env.SMTP_FROM?.trim() || `Hira Agro Industry <${envUser}>`,
    };
  }

  if (business?.smtp_user && business?.smtp_pass_enc) {
    try {
      const pass = decryptSensitiveText(business.smtp_pass_enc);
      if (pass) {
        return {
          mode: 'SMTP',
          host: business.smtp_host || 'smtp.gmail.com',
          port: Number(business.smtp_port || 465),
          user: business.smtp_user,
          pass,
          from: business.smtp_from || `Hira Agro Industry <${business.smtp_user}>`,
        };
      }
    } catch {
      return { mode: 'NONE' };
    }
  }

  return { mode: 'NONE' };
}

export function isEmailDeliveryConfigured(business: any): boolean {
  return resolveMailConfig(business).mode !== 'NONE';
}

export async function sendMailMessage(business: any, req: EmailSendRequest): Promise<void> {
  if (customEmailSender) {
    await customEmailSender(req);
    return;
  }

  const cfg = resolveMailConfig(business);
  if (cfg.mode === 'NONE') {
    throw new Error(
      'Email OTP delivery is not configured on the server yet. Admin must set Gmail App Password in Admin Settings (or SMTP_USER / SMTP_PASS in Render).'
    );
  }

  if (cfg.mode === 'RESEND') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [req.to],
        subject: req.subject,
        text: req.text,
        html: req.html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Email API failed (${res.status}): ${errText}`);
    }
    return;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host || 'smtp.gmail.com',
    port: cfg.port || 465,
    secure: (cfg.port || 465) === 465,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  await transporter.sendMail({
    from: cfg.from,
    to: req.to,
    subject: req.subject,
    text: req.text,
    html: req.html,
  });
}

export async function sendLoginOtpEmail(input: {
  business: any;
  to: string;
  fullName: string;
  username: string;
  otp: string;
  deviceName: string;
}) {
  const millName = input.business?.name || 'Hira Agro Industry';
  const subject = `${input.otp} is your ${millName} login verification OTP`;
  const text = [
    `${millName} — Security Verification`,
    ``,
    `Hello ${input.fullName} (@${input.username}),`,
    `Your one-time login verification OTP is: ${input.otp}`,
    `Device attempting sign in: ${input.deviceName}`,
    `This OTP is valid for 10 minutes and works once.`,
    ``,
    `SECURITY WARNING: If you did not try to log in right now, someone may know your password. Do NOT share this OTP and change your password immediately.`,
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; border: 1px solid #d6d3d1; border-radius: 14px; overflow: hidden;">
      <div style="background: #1B4D3E; color: #ffffff; padding: 18px 22px;">
        <h2 style="margin: 0; font-size: 18px;">${millName} — Login Verification</h2>
      </div>
      <div style="padding: 22px; background: #FAF7F0; color: #1F2937;">
        <p style="margin-top: 0;">Hello <strong>${input.fullName}</strong> (@${input.username}),</p>
        <p>Use this one-time verification code to complete sign in on <strong>${input.deviceName}</strong>:</p>
        <div style="background: #ffffff; border: 2px dashed #1B4D3E; border-radius: 12px; text-align: center; padding: 16px; margin: 18px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1B4D3E; font-family: monospace;">${input.otp}</span>
        </div>
        <p style="font-size: 13px; color: #57534e;">Valid for <strong>10 minutes</strong> for a single sign-in.</p>
        <div style="background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 10px; padding: 12px; font-size: 12px; color: #7F1D1D;">
          <strong>Security Notice:</strong> Never share this OTP with anyone. If you did not attempt to log in right now, someone knows your password — change your password immediately inside Security Settings.
        </div>
      </div>
    </div>
  `;

  await sendMailMessage(input.business, { to: input.to, subject, text, html });
}
