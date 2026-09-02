// import nodemailer from "nodemailer";
// import { Resend } from "resend";

// const getFromEmail = () =>
//   process.env.EMAIL_FROM || process.env.EMAIL_USER || "no-reply@keeto.app";

// const getResendClient = () => {
//   if (!process.env.RESEND_API_KEY) return null;
//   return new Resend(process.env.RESEND_API_KEY);
// };

// const getSmtpTransporter = () => {
//   const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER;
//   const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS;

//   if (!SMTP_USER || !SMTP_PASS) {
//     console.log("❌ SMTP not configured");
//     return null;
//   }

//   return nodemailer.createTransport({
//     service: "gmail",
//     auth: {
//       user: SMTP_USER,
//       pass: SMTP_PASS,
//     },
//   });
// };

// export const sendEmail = async ({
//   to,
//   subject,
//   html,
// }: {
//   to: string;
//   subject: string;
//   html: string;
// }) => {
//   console.log("📧 Sending email to:", to);

//   const resend = getResendClient();

//   // ===== Resend =====
//   if (resend) {
//     try {
//       await resend.emails.send({
//         from: getFromEmail(),
//         to,
//         subject,
//         html,
//       });

//       console.log("✅ Email sent via Resend");
//       return;
//     } catch (err) {
//       console.log("❌ Resend error:", err);
//     }
//   }

//   // ===== SMTP (Gmail) =====
//   const transporter = getSmtpTransporter();

//   if (transporter) {
//     try {
//       await transporter.sendMail({
//         from: getFromEmail(),
//         to,
//         subject,
//         html,
//       });

//       console.log("✅ Email sent via SMTP");
//       return;
//     } catch (err) {
//       console.log("❌ SMTP error:", err);
//     }
//   }

//   console.log("⚠️ No email provider configured. Email not sent.");
// };


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

const getSmtpTransporter = () => {
  const host = process.env.SMTP_HOST || "mail.keeto.org";
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.log("❌ SMTP not configured — SMTP_USER or SMTP_PASS missing");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: false, // Must be false for port 587 (uses STARTTLS)
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false, // Prevents failures with self-signed certificates on Plesk
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