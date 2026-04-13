'use strict';

const { body, param, validationResult } = require('express-validator');

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
}

const authLoginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

const authRegisterRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be 8+ chars with uppercase, lowercase, and number'),
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters'),
];

const credentialRules = [
  body('service')
    .trim()
    .isIn(['meta', 'google-calendar', 'google-gmail', 'whatsapp', 'github', 'openai', 'gemini', 'hubspot'])
    .withMessage('Invalid service name'),
  body('apiKey').trim().isLength({ min: 1 }).withMessage('API key is required'),
];

const serviceParamRule = [
  param('service')
    .isIn(['meta', 'google-calendar', 'google-gmail', 'whatsapp', 'github', 'openai', 'gemini', 'hubspot'])
    .withMessage('Invalid service name'),
];

const aiGenerateRules = [
  body('prompt').trim().isLength({ min: 1, max: 4000 }).withMessage('Prompt must be 1–4000 chars'),
  body('model').optional().isString().withMessage('Model must be a string'),
];

const aiAnalyzeRules = [
  body('campaignData').isObject().withMessage('campaignData must be an object'),
];

module.exports = {
  handleValidationErrors,
  authLoginRules,
  authRegisterRules,
  credentialRules,
  serviceParamRule,
  aiGenerateRules,
  aiAnalyzeRules,
};
