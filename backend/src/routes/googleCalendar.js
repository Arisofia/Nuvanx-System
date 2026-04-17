'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const googleCalendar = require('../services/googleCalendar');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/google-calendar/auth-url
 * Returns the Google OAuth2 authorization URL.
 */
router.get('/auth-url', (req, res, next) => {
  try {
    const state = req.user.id; // pass user ID as state for callback
    const url = googleCalendar.getAuthUrl(state);
    res.json({ success: true, url });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/google-calendar/callback
 * OAuth2 callback — exchanges code for tokens, stores refresh token.
 */
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Missing authorization code' });
    }
    const result = await googleCalendar.handleCallback(req.user.id, code);
    res.json({ success: true, connected: true, expiresIn: result.expiresIn });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/google-calendar/events
 * Create a calendar event (appointment booking).
 * Body: { summary, description?, startDateTime, endDateTime, attendees?, timeZone? }
 */
router.post('/events', async (req, res, next) => {
  try {
    const { summary, description, startDateTime, endDateTime, attendees, timeZone } = req.body;
    if (!summary || !startDateTime || !endDateTime) {
      return res.status(400).json({
        success: false,
        message: 'summary, startDateTime, and endDateTime are required',
      });
    }
    const event = await googleCalendar.createEvent(req.user.id, {
      summary,
      description,
      startDateTime,
      endDateTime,
      attendees,
      timeZone,
    });
    res.json({
      success: true,
      event: {
        id: event.id,
        htmlLink: event.htmlLink,
        summary: event.summary,
        start: event.start,
        end: event.end,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/google-calendar/events
 * List upcoming events (next 7 days).
 */
router.get('/events', async (req, res, next) => {
  try {
    const events = await googleCalendar.listUpcoming(req.user.id);
    res.json({
      success: true,
      events: events.map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start,
        end: e.end,
        htmlLink: e.htmlLink,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
