import nodemailer from "nodemailer";
import { Resend } from "resend";

const getFromEmail = () =>
  process.env.EMAIL_FROM ||
  process.env.SMTP_USER ||
  "Keeto <keetofoodapp@keeto.org>";

const getResendClient = () => {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
};

// ✅ Singleton SMTP transporter — created once, reused for all emails
let _smtpTransporter: nodemailer.Transporter | null = null;

const getSmtpTransporter = () => {
  if (_smtpTransporter) return _smtpTransporter;

  const host = process.env.SMTP_HOST || "mail.keeto.org";
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.log("❌ SMTP not configured — SMTP_USER or SMTP_PASS missing");
    return null;
  }

  _smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    pool: true,           // ✅ Connection pooling — reuse TCP connections
    maxConnections: 5,    // ✅ Max 5 simultaneous connections to SMTP
    maxMessages: 100,     // ✅ Max 100 messages per connection
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,  // ✅ 10s to connect
    greetingTimeout: 10000,    // ✅ 10s for SMTP greeting
    socketTimeout: 15000,      // ✅ 15s per send operation
  });

  return _smtpTransporter;
};

export const sendEmail = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) => {
  console.log("📧 Sending email to:", to, "| Subject:", subject);

  const resend = getResendClient();

  // ===== 1. Try Resend First =====
  if (resend) {
    try {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to,
        subject,
        html,
      });
      console.log("✅ Email sent via Resend");
      return;
    } catch (err) {
      console.error("❌ Resend error, falling back to SMTP:", err);
    }
  }

  // ===== 2. Fallback: Custom Plesk SMTP =====
  const transporter = getSmtpTransporter();

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: getFromEmail(),
        to,
        subject,
        html,
      });

      console.log("✅ Email sent via Plesk SMTP — Message ID:", info.messageId);
      return info;
    } catch (err: any) {
      console.error("❌ SMTP Error:", err?.message || err);
      throw new Error(`Failed to send email via SMTP: ${err?.message}`);
    }
  }

  // ===== 3. No Provider Configured =====
  const msg = "⚠️ No email provider configured. Check SMTP_USER and SMTP_PASS in .env";
  console.error(msg);
  throw new Error(msg);
};
