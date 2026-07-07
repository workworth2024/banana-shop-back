import nodemailer from 'nodemailer';

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const host = process.env.ZOHO_SMTP_HOST || 'smtp.zoho.eu';
  const port = Number(process.env.ZOHO_SMTP_PORT) || 465;
  const user = process.env.ZOHO_SMTP_USER;
  const pass = process.env.ZOHO_SMTP_PASS;

  if (!user || !pass) {
    console.error('[Mailer] ZOHO_SMTP_USER / ZOHO_SMTP_PASS are not set. Emails will not be sent.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  return transporter;
};

const fromAddress = () =>
  process.env.ZOHO_MAIL_FROM || process.env.ZOHO_SMTP_USER || 'no-reply@banana-traff-shop.com';

export const sendMail = async ({ to, subject, text, html }) => {
  const tx = getTransporter();
  if (!tx) return false;

  try {
    const info = await tx.sendMail({ from: fromAddress(), to, subject, text, html });
    console.log('[Mailer] sent:', info.messageId, '->', to);
    return true;
  } catch (error) {
    console.error('[Mailer] send error:', error.message);
    return false;
  }
};

const codeEmailHtml = (title, intro, code) => `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f0f0f;color:#f5f5f5;border-radius:12px">
    <h2 style="margin:0 0 16px;color:#ffd24a">Banana Traff Shop</h2>
    <p style="margin:0 0 8px;font-size:16px">${title}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#bdbdbd">${intro}</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:16px;background:#1c1c1c;border-radius:10px;color:#ffd24a">${code}</div>
    <p style="margin:20px 0 0;font-size:12px;color:#8a8a8a">If you did not request this, you can safely ignore this email.</p>
  </div>
`;

export const sendVerificationEmail = async (to, code) => {
  return sendMail({
    to,
    subject: 'Your Banana Traff verification code',
    text: `Your verification code is: ${code}\nIt is valid for 15 minutes.`,
    html: codeEmailHtml(
      'Confirm your email address',
      'Use the code below to finish creating your account. It is valid for 15 minutes.',
      code
    )
  });
};

export const sendPasswordResetEmail = async (to, code) => {
  return sendMail({
    to,
    subject: 'Your Banana Traff password reset code',
    text: `Your password reset code is: ${code}\nIt is valid for 15 minutes.`,
    html: codeEmailHtml(
      'Reset your password',
      'Use the code below to reset your password. It is valid for 15 minutes.',
      code
    )
  });
};
