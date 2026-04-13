'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Verify a Google OAuth2 access token.
 * @param {string} accessToken
 * @returns {{ connected: boolean, email?: string, error?: string }}
 */
async function testConnection(accessToken) {
  try {
    const { data } = await axios.get('https://www.googleapis.com/oauth2/v3/tokeninfo', {
      params: { access_token: accessToken },
      timeout: 10000,
    });
    return { connected: true, email: data.email };
  } catch (err) {
    const message = err.response?.data?.error_description || err.message;
    logger.warn('Google testConnection failed', { error: message });
    return { connected: false, error: message };
  }
}

/**
 * Create a Google Calendar event.
 * @param {string} accessToken
 * @param {object} eventData  Calendar event resource
 * @param {string} [calendarId='primary']
 */
async function createCalendarEvent(accessToken, eventData, calendarId = 'primary') {
  const { data } = await axios.post(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    eventData,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    },
  );
  return data;
}

/**
 * List upcoming calendar events.
 * @param {string} accessToken
 * @param {number} [maxResults=10]
 */
async function listCalendarEvents(accessToken, maxResults = 10) {
  const { data } = await axios.get(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        timeMin: new Date().toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      },
      timeout: 15000,
    },
  );
  return data.items || [];
}

/**
 * Send an email via the Gmail API.
 * @param {string} accessToken
 * @param {{ to: string, subject: string, body: string }} emailData
 */
async function sendEmail(accessToken, emailData) {
  const { to, subject, body } = emailData;
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
  )
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const { data } = await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw },
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    },
  );
  return data;
}

module.exports = { testConnection, createCalendarEvent, listCalendarEvents, sendEmail };
