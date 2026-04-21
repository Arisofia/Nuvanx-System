'use strict';

const { Resend } = require('resend');
const { config } = require('../config/env');
const logger = require('../utils/logger');

let resend = null;

function getClient() {
  if (!resend && config.resendApiKey) {
    resend = new Resend(config.resendApiKey);
  }
  return resend;
}

/**
 * Send a password-reset email containing the reset link.
 * Returns true if sent, false if email transport is not configured.
 */
async function sendPasswordResetEmail(toEmail, resetToken) {
  const client = getClient();
  if (!client) {
    logger.warn('Email transport not configured (RESEND_API_KEY missing) — reset email not sent', { toEmail });
    return false;
  }

  const resetUrl = `${config.frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

  const { error } = await client.emails.send({
    from: config.emailFrom,
    to: toEmail,
    subject: 'Reset your Nuvanx password',
    html: `
      <p>You requested a password reset for your Nuvanx account.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `,
  });

  if (error) {
    logger.error('Failed to send password reset email', { toEmail, error: error.message });
    return false;
  }

  logger.info('Password reset email sent', { toEmail });
  return true;
}

module.exports = { sendPasswordResetEmail };
