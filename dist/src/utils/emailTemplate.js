"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.passwordResetTemplate = exports.emailVerificationLinkTemplate = exports.resendVerificationTemplate = exports.verificationEmailTemplate = void 0;
const publicAppUrl = (process.env.PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const mathsHouseLogoUrl = `${publicAppUrl}/public/mathshouse_white_logoHeader.png`;
// ===================================
// Base Template - Clean Blue & White
// ===================================
const baseTemplate = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="
  margin: 0;
  padding: 0;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: #f0f5ff;
">
  <table width="100%" cellpadding="0" cellspacing="0" style="
    background-color: #f0f5ff;
    padding: 40px 20px;
  ">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="
          background-color: #ffffff;
          border-radius: 24px;
          box-shadow: 0 20px 60px rgba(37, 99, 235, 0.1);
          overflow: hidden;
          max-width: 100%;
          border: 1px solid rgba(37, 99, 235, 0.08);
        ">
          <!-- Header -->
          <tr>
            <td style="
              background: #ffffff;
              padding: 40px 30px 20px;
              text-align: center;
              border-bottom: 1px solid #e8f0fe;
            ">
              <div style="
                display: inline-block;
                background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
                padding: 12px 24px;
                border-radius: 50px;
                margin-bottom: 15px;
              ">
                <span style="
                  color: #ffffff;
                  font-size: 24px;
                  font-weight: 700;
                ">📚 Online Library</span>
              </div>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 45px;">
              ${content}
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="
              background-color: #f8faff;
              padding: 25px 30px;
              text-align: center;
              border-top: 1px solid #e8f0fe;
            ">
              <p style="
                color: #64748b;
                margin: 0;
                font-size: 13px;
              ">© 2025 Online Library • Made with 💙</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
// ===================================
// Verification Email Template (Signup)
// ===================================
const verificationEmailTemplate = (name, code) => {
    const logoMarkup = `<img src="${mathsHouseLogoUrl}" alt="Maths House" style="max-width: 240px; width: 100%; height: auto; display: block; margin: 0 auto;" />`;
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f6f6f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(180deg, #fff5f5 0%, #ffffff 100%); padding: 36px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 640px; background: #ffffff; border-radius: 28px; overflow: hidden; border: 1px solid #f2d6d9; box-shadow: 0 18px 60px rgba(215, 25, 40, 0.14);">
          <tr>
            <td style="background: linear-gradient(135deg, #d71928 0%, #ef233c 55%, #b91c1c 100%); padding: 32px 28px 18px; text-align: center;">
              <div style="max-width: 360px; margin: 0 auto; background: #ffffff; border-radius: 22px; padding: 12px 18px 14px; box-shadow: 0 10px 30px rgba(127, 29, 29, 0.18); border: 1px solid rgba(255,255,255,0.65);">
                <div style="height: 3px; width: 100%; border-radius: 999px; background: linear-gradient(90deg, rgba(215,25,40,0) 0%, #d71928 18%, #ef233c 50%, #d71928 82%, rgba(215,25,40,0) 100%);"></div>
                <div style="padding: 12px 8px 10px;">
                  ${logoMarkup}
                </div>
                <div style="height: 3px; width: 100%; border-radius: 999px; background: linear-gradient(90deg, rgba(215,25,40,0) 0%, #d71928 18%, #ef233c 50%, #d71928 82%, rgba(215,25,40,0) 100%);"></div>
              </div>
              <div style="margin-top: 18px; color: rgba(255,255,255,0.82); font-size: 13px; line-height: 1.8; letter-spacing: 0.8px;">x + y = z &nbsp;&nbsp; • &nbsp;&nbsp; a² + b² = c² &nbsp;&nbsp; • &nbsp;&nbsp; π &nbsp;&nbsp; • &nbsp;&nbsp; √16 = 4</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 34px 34px; text-align: center;">
              <div style="display: inline-block; padding: 10px 16px; border-radius: 999px; background: #fff1f2; color: #d71928; font-size: 13px; font-weight: 700; letter-spacing: 0.6px; border: 1px solid #fecdd3;">WELCOME TO MATHS HOUSE</div>
              <h1 style="margin: 18px 0 10px; color: #202124; font-size: 32px; line-height: 1.2; font-weight: 800;">Verify your email address</h1>
              <p style="margin: 0 0 24px; color: #5f6368; font-size: 16px; line-height: 1.8;">Hi ${name}, welcome back. Use the verification code below to activate your account and start your learning journey.</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(180deg, #fffafa 0%, #ffffff 100%); border: 1px solid #f5c2c7; border-radius: 24px; margin-bottom: 18px;">
                <tr>
                  <td style="padding: 24px 22px 10px; text-align: center; color: #b91c1c; font-size: 13px; font-weight: 700; letter-spacing: 2px;">VERIFICATION CODE</td>
                </tr>
                <tr>
                  <td style="padding: 0 22px 22px; text-align: center;">
                    <div style="background: linear-gradient(135deg, #d71928 0%, #ef233c 100%); border-radius: 18px; padding: 22px 12px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.22);">
                      <div style="color: #ffffff; font-size: 40px; line-height: 1; font-weight: 800; letter-spacing: 14px;">${code}</div>
                    </div>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius: 18px; background: #fff5f5; border: 1px dashed #f3a6ad; margin-bottom: 18px;">
                <tr>
                  <td style="padding: 16px 18px; text-align: center; color: #7f1d1d; font-size: 15px; line-height: 1.7;">⏱️ This verification code expires in <strong>2 hours</strong>.</td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius: 18px; background: #ffffff; border: 1px solid #f1d4d7;">
                <tr>
                  <td style="padding: 18px 20px; color: #4b5563; font-size: 14px; line-height: 1.8; text-align: center;"><strong style="color: #d71928;">Maths House note:</strong> If you did not create this account, you can safely ignore this email.</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};
exports.verificationEmailTemplate = verificationEmailTemplate;
// ===================================
// Resend Verification Template
// ===================================
const resendVerificationTemplate = (name, code) => {
    const logoMarkup = `<img src="${mathsHouseLogoUrl}" alt="Maths House" style="max-width: 240px; width: 100%; height: auto; display: block; margin: 0 auto;" />`;
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f6f6f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(180deg, #fff5f5 0%, #ffffff 100%); padding: 36px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 640px; background: #ffffff; border-radius: 28px; overflow: hidden; border: 1px solid #f2d6d9; box-shadow: 0 18px 60px rgba(215, 25, 40, 0.14);">
          <tr>
            <td style="background: linear-gradient(135deg, #d71928 0%, #ef233c 55%, #b91c1c 100%); padding: 32px 28px 18px; text-align: center;">
              <div style="max-width: 360px; margin: 0 auto; background: #ffffff; border-radius: 22px; padding: 12px 18px 14px; box-shadow: 0 10px 30px rgba(127, 29, 29, 0.18); border: 1px solid rgba(255,255,255,0.65);">
                <div style="height: 3px; width: 100%; border-radius: 999px; background: linear-gradient(90deg, rgba(215,25,40,0) 0%, #d71928 18%, #ef233c 50%, #d71928 82%, rgba(215,25,40,0) 100%);"></div>
                <div style="padding: 12px 8px 10px;">
                  ${logoMarkup}
                </div>
                <div style="height: 3px; width: 100%; border-radius: 999px; background: linear-gradient(90deg, rgba(215,25,40,0) 0%, #d71928 18%, #ef233c 50%, #d71928 82%, rgba(215,25,40,0) 100%);"></div>
              </div>
              <div style="margin-top: 18px; color: rgba(255,255,255,0.82); font-size: 13px; line-height: 1.8; letter-spacing: 0.8px;">sin θ &nbsp;&nbsp; • &nbsp;&nbsp; cos θ &nbsp;&nbsp; • &nbsp;&nbsp; 2x + 3 = 11 &nbsp;&nbsp; • &nbsp;&nbsp; ∑ n</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 34px 34px; text-align: center;">
              <div style="display: inline-block; padding: 10px 16px; border-radius: 999px; background: #fff1f2; color: #d71928; font-size: 13px; font-weight: 700; letter-spacing: 0.6px; border: 1px solid #fecdd3;">NEW CODE READY</div>
              <h1 style="margin: 18px 0 10px; color: #202124; font-size: 32px; line-height: 1.2; font-weight: 800;">Your new verification code</h1>
              <p style="margin: 0 0 24px; color: #5f6368; font-size: 16px; line-height: 1.8;">Hi ${name}, here is your fresh code. Enter it to continue verifying your account.</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(180deg, #fffafa 0%, #ffffff 100%); border: 1px solid #f5c2c7; border-radius: 24px; margin-bottom: 18px;">
                <tr>
                  <td style="padding: 24px 22px 10px; text-align: center; color: #b91c1c; font-size: 13px; font-weight: 700; letter-spacing: 2px;">FRESH VERIFICATION CODE</td>
                </tr>
                <tr>
                  <td style="padding: 0 22px 22px; text-align: center;">
                    <div style="background: linear-gradient(135deg, #d71928 0%, #ef233c 100%); border-radius: 18px; padding: 22px 12px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.22);">
                      <div style="color: #ffffff; font-size: 40px; line-height: 1; font-weight: 800; letter-spacing: 14px;">${code}</div>
                    </div>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius: 18px; background: #fff5f5; border: 1px dashed #f3a6ad; margin-bottom: 18px;">
                <tr>
                  <td style="padding: 16px 18px; text-align: center; color: #7f1d1d; font-size: 15px; line-height: 1.7;">⏱️ This code stays valid for <strong>2 hours</strong>.</td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius: 18px; background: #ffffff; border: 1px solid #f1d4d7;">
                <tr>
                  <td style="padding: 18px 20px; color: #4b5563; font-size: 14px; line-height: 1.8; text-align: center;"><strong style="color: #d71928;">Quick tip:</strong> Use the latest code only. Older verification codes will no longer be valid.</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};
exports.resendVerificationTemplate = resendVerificationTemplate;
const emailVerificationLinkTemplate = (name, verificationUrl, expiresInText = "1 hour") => {
    const logoMarkup = `<img src="${mathsHouseLogoUrl}" alt="Maths House" style="max-width: 240px; width: 100%; height: auto; display: block; margin: 0 auto;" />`;
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f6f6f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(180deg, #fff5f5 0%, #ffffff 100%); padding: 36px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 640px; background: #ffffff; border-radius: 28px; overflow: hidden; border: 1px solid #f2d6d9; box-shadow: 0 18px 60px rgba(215, 25, 40, 0.14);">
          <tr>
            <td style="background: linear-gradient(135deg, #d71928 0%, #ef233c 55%, #b91c1c 100%); padding: 32px 28px 18px; text-align: center;">
              <div style="max-width: 360px; margin: 0 auto; background: #ffffff; border-radius: 22px; padding: 12px 18px 14px; box-shadow: 0 10px 30px rgba(127, 29, 29, 0.18); border: 1px solid rgba(255,255,255,0.65);">
                <div style="height: 3px; width: 100%; border-radius: 999px; background: linear-gradient(90deg, rgba(215,25,40,0) 0%, #d71928 18%, #ef233c 50%, #d71928 82%, rgba(215,25,40,0) 100%);"></div>
                <div style="padding: 12px 8px 10px;">${logoMarkup}</div>
                <div style="height: 3px; width: 100%; border-radius: 999px; background: linear-gradient(90deg, rgba(215,25,40,0) 0%, #d71928 18%, #ef233c 50%, #d71928 82%, rgba(215,25,40,0) 100%);"></div>
              </div>
              <div style="margin-top: 18px; color: rgba(255,255,255,0.82); font-size: 13px; line-height: 1.8; letter-spacing: 0.8px;">x² + y² = z² &nbsp;&nbsp; • &nbsp;&nbsp; π &nbsp;&nbsp; • &nbsp;&nbsp; ∑ n &nbsp;&nbsp; • &nbsp;&nbsp; Δ = b² - 4ac</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 34px 34px; text-align: center;">
              <div style="display: inline-block; padding: 10px 16px; border-radius: 999px; background: #fff1f2; color: #d71928; font-size: 13px; font-weight: 700; letter-spacing: 0.6px; border: 1px solid #fecdd3;">VERIFY YOUR EMAIL</div>
              <h1 style="margin: 18px 0 10px; color: #202124; font-size: 32px; line-height: 1.2; font-weight: 800;">Confirm your email address</h1>
              <p style="margin: 0 0 24px; color: #5f6368; font-size: 16px; line-height: 1.8;">Hi ${name}, click the button below to verify your email and activate your Maths House account.</p>
              <div style="margin: 0 0 20px;">
                <a href="${verificationUrl}" style="display: inline-block; background: linear-gradient(135deg, #d71928 0%, #ef233c 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 700; padding: 16px 28px; border-radius: 14px;">Verify Email</a>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius: 18px; background: #fff5f5; border: 1px dashed #f3a6ad; margin-bottom: 18px;">
                <tr>
                  <td style="padding: 16px 18px; text-align: center; color: #7f1d1d; font-size: 15px; line-height: 1.7;">⏱️ This verification link expires in <strong>${expiresInText}</strong>.</td>
                </tr>
              </table>
              <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.8;">If the button does not work, <a href="${verificationUrl}" style="color: #d71928; font-weight: 700; text-decoration: underline;">click here</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
exports.emailVerificationLinkTemplate = emailVerificationLinkTemplate;
// ===================================
// Password Reset Template
// ===================================
const passwordResetTemplate = (name, code, expiresInText = "5 minutes") => {
    const logoMarkup = `<img src="${mathsHouseLogoUrl}" alt="Maths House" style="max-width: 240px; width: 100%; height: auto; display: block; margin: 0 auto;" />`;
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="
  margin: 0;
  padding: 0;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: #f6f6f6;
">
  <table width="100%" cellpadding="0" cellspacing="0" style="
    background: linear-gradient(180deg, #fff5f5 0%, #ffffff 100%);
    padding: 36px 16px;
  ">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="
          width: 100%;
          max-width: 640px;
          background: #ffffff;
          border-radius: 28px;
          overflow: hidden;
          border: 1px solid #f2d6d9;
          box-shadow: 0 18px 60px rgba(215, 25, 40, 0.14);
        ">
          <tr>
            <td style="
              background: linear-gradient(135deg, #d71928 0%, #ef233c 55%, #b91c1c 100%);
              padding: 32px 28px 18px;
              text-align: center;
            ">
              <div style="max-width: 360px; margin: 0 auto; background: #ffffff; border-radius: 22px; padding: 12px 18px 14px; box-shadow: 0 10px 30px rgba(127, 29, 29, 0.18); border: 1px solid rgba(255,255,255,0.65);">
                <div style="height: 3px; width: 100%; border-radius: 999px; background: linear-gradient(90deg, rgba(215,25,40,0) 0%, #d71928 18%, #ef233c 50%, #d71928 82%, rgba(215,25,40,0) 100%);"></div>
                <div style="padding: 12px 8px 10px;">
                  ${logoMarkup}
                </div>
                <div style="height: 3px; width: 100%; border-radius: 999px; background: linear-gradient(90deg, rgba(215,25,40,0) 0%, #d71928 18%, #ef233c 50%, #d71928 82%, rgba(215,25,40,0) 100%);"></div>
              </div>
              <div style="
                margin-top: 18px;
                color: rgba(255,255,255,0.82);
                font-size: 13px;
                line-height: 1.8;
                letter-spacing: 0.8px;
              ">x² + y² = z² &nbsp;&nbsp; • &nbsp;&nbsp; ∫ f(x)dx &nbsp;&nbsp; • &nbsp;&nbsp; π ≈ 3.14159 &nbsp;&nbsp; • &nbsp;&nbsp; Δ = b² - 4ac</div>
            </td>
          </tr>

          <tr>
            <td style="padding: 0; background: #ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 28px 34px 8px; text-align: center;">
                    <div style="
                      display: inline-block;
                      padding: 10px 16px;
                      border-radius: 999px;
                      background: #fff1f2;
                      color: #d71928;
                      font-size: 13px;
                      font-weight: 700;
                      letter-spacing: 0.6px;
                      border: 1px solid #fecdd3;
                    ">PASSWORD RESET REQUEST</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 34px 0; text-align: center;">
                    <h1 style="
                      margin: 0;
                      color: #202124;
                      font-size: 32px;
                      line-height: 1.2;
                      font-weight: 800;
                    ">Reset your Maths House password</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 44px 0; text-align: center;">
                    <p style="
                      margin: 0;
                      color: #5f6368;
                      font-size: 16px;
                      line-height: 1.8;
                    ">Hi ${name}, we received a request to reset your password. Use the code below to continue securely.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 26px 34px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="
                      background: linear-gradient(180deg, #fffafa 0%, #ffffff 100%);
                      border: 1px solid #f5c2c7;
                      border-radius: 24px;
                    ">
                      <tr>
                        <td style="padding: 24px 22px 10px; text-align: center; color: #b91c1c; font-size: 13px; font-weight: 700; letter-spacing: 2px;">
                          YOUR 6-DIGIT CODE
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 22px 22px; text-align: center;">
                          <div style="
                            background: linear-gradient(135deg, #d71928 0%, #ef233c 100%);
                            border-radius: 18px;
                            padding: 22px 12px;
                            box-shadow: inset 0 1px 0 rgba(255,255,255,0.22);
                          ">
                            <div style="
                              color: #ffffff;
                              font-size: 40px;
                              line-height: 1;
                              font-weight: 800;
                              letter-spacing: 14px;
                            ">${code}</div>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 34px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="
                      border-radius: 18px;
                      background: #fff5f5;
                      border: 1px dashed #f3a6ad;
                    ">
                      <tr>
                        <td style="padding: 16px 18px; text-align: center; color: #7f1d1d; font-size: 15px; line-height: 1.7;">
                          ⏱️ This code expires in <strong>${expiresInText}</strong><br />
                          Solve it fast before time runs out.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 22px 34px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="
                      border-radius: 18px;
                      background: #ffffff;
                      border: 1px solid #f1d4d7;
                    ">
                      <tr>
                        <td style="padding: 18px 20px; color: #4b5563; font-size: 14px; line-height: 1.8; text-align: center;">
                          <strong style="color: #d71928;">Math tip:</strong> Never share this code with anyone.<br />
                          If you did not request a reset, you can safely ignore this email.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 26px 34px 34px; text-align: center; color: #9ca3af; font-size: 12px; line-height: 1.8;">
                    <div style="margin-bottom: 8px; color: #d71928; font-weight: 700; letter-spacing: 1px;">MATHS HOUSE</div>
                    <div>Practice. Progress. Precision.</div>
                    <div style="margin-top: 8px;">© 2026 Maths House</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};
exports.passwordResetTemplate = passwordResetTemplate;
