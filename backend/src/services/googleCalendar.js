'use strict';

/**
 * Google Calendar integration service.
 *
 * Uses the Google Calendar API v3 via direct REST calls (no googleapis SDK).
 * Auth flow: per-user OAuth2 refresh tokens stored in the credential vault.
 */

const axios = require('axios');
const { config } = require('../config/env');
const credentialModel = require('../models/credential');
const logger = require('../utils/logger');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Generate the Google OAuth2 authorization URL.
 * The frontend redirects the user here to grant calendar access.
 */
function getAuthUrl(state) {
  if (!config.googleClientId || !config.googleRedirectUri) {
    throw new Error('Google Calendar OAuth not configured');
  }
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent',
    state: state || '',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Exchange an authorization code for tokens and store the refresh token.
 */
async function handleCallback(userId, code) {
  if (!config.googleClientId || !config.googleClientSecret || !config.googleRedirectUri) {
    throw new Error('Google Calendar OAuth not configured');
  }

  const { data } = await axios.post(GOOGLE_TOKEN_URL, {
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.googleRedirectUri,
  }, { timeout: 10000 });

  // Store refresh token in encrypted vault
  if (data.refresh_token) {
    await credentialModel.save(userId, 'google_calendar', data.refresh_token);
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token || null,
  };
}

/**
 * Get a fresh access token using the stored refresh token.
 */
async function getAccessToken(userId) {
  const refreshToken = await credentialModel.getDecryptedKey(userId, 'google_calendar');
  if (!refreshToken) {
    throw new Error('Google Calendar not connected — no refresh token found');
  }

  const { data } = await axios.post(GOOGLE_TOKEN_URL, {
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }, { timeout: 10000 });

  return data.access_token;
}

/**
 * Create a calendar event (booking).
 * @param {string} userId
 * @param {object} event  { summary, description, startDateTime, endDateTime, attendees, timeZone }
 * @returns {object} Created event from Google Calendar API
 */
async function createEvent(userId, { summary, description, startDateTime, endDateTime, attendees, timeZone }) {
  const accessToken = await getAccessToken(userId);

  const eventBody = {
    summary,
    description: description || '',
    start: { dateTime: startDateTime, timeZone: timeZone || 'America/Mexico_City' },
    end: { dateTime: endDateTime, timeZone: timeZone || 'America/Mexico_City' },
    attendees: (attendees || []).map((email) => ({ email })),
    reminders: { useDefault: true },
  };

  const { data } = await axios.post(
    `${CALENDAR_BASE}/calendars/primary/events`,
    eventBody,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      params: { sendUpdates: 'all' },
      timeout: 15000,
    },
  );

  logger.info('[google-calendar] Event created', { eventId: data.id, summary });
  return data;
}

/**
 * List upcoming calendar events (next 7 days).
 */
async function listUpcoming(userId, maxResults = 10) {
  const accessToken = await getAccessToken(userId);

  const now = new Date().toISOString();
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await axios.get(`${CALENDAR_BASE}/calendars/primary/events`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      timeMin: now,
      timeMax: weekFromNow,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    },
    timeout: 15000,
  });

  return data.items || [];
}

module.exports = { getAuthUrl, handleCallback, getAccessToken, createEvent, listUpcoming };
