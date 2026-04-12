import nodemailer from "nodemailer";
import { Resend } from "resend";

const getFromEmail = () =>
  process.env.EMAIL_FROM || process.env.EMAIL_USER || "no-reply@keeto.app";

const getResendClient = () => {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
};

const getSmtpTransporter = () => {
  const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER;
  const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  if (!SMTP_USER || !SMTP_PASS) {
    console.log("❌ SMTP not configured");
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
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
  console.log("📧 Sending email to:", to);

  const resend = getResendClient();

  // ===== Resend =====
  if (resend) {
    try {
      await resend.emails.send({
        from: getFromEmail(),
        to,
        subject,
        html,
      });

      console.log("✅ Email sent via Resend");
      return;
    } catch (err) {
      console.log("❌ Resend error:", err);
    }
  }

  // ===== SMTP (Gmail) =====
  const transporter = getSmtpTransporter();

  if (transporter) {
    try {
      await transporter.sendMail({
        from: getFromEmail(),
        to,
        subject,
        html,
      });

      console.log("✅ Email sent via SMTP");
      return;
    } catch (err) {
      console.log("❌ SMTP error:", err);
    }
  }

  console.log("⚠️ No email provider configured. Email not sent.");
};