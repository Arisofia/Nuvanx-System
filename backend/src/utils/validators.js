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
    .isIn(['meta', 'whatsapp', 'github', 'openai', 'gemini'])
    .withMessage('Invalid service name'),
  body('apiKey').trim().isLength({ min: 1 }).withMessage('API key is required'),
];

const serviceParamRule = [
  param('service')
    .isIn(['meta', 'whatsapp', 'github', 'openai', 'gemini'])
    .withMessage('Invalid service name'),
];

const aiGenerateRules = [
  body('prompt').trim().isLength({ min: 1, max: 4000 }).withMessage('Prompt must be 1–4000 chars'),
  body('model').optional().isString().withMessage('Model must be a string'),
];

const aiAnalyzeRules = [
  body('campaignData')
    .custom((value) => typeof value === 'string' || (typeof value === 'object' && value !== null))
    .withMessage('campaignData must be a string or object'),
];

const connectRules = [
  body('token').optional().isString().isLength({ min: 1 }).withMessage('token must be a non-empty string'),
  body('apiKey').optional().isString().isLength({ min: 1 }).withMessage('apiKey must be a non-empty string'),
  body('metadata').optional().isObject().withMessage('metadata must be an object'),
];

module.exports = {
  handleValidationErrors,
  authLoginRules,
  authRegisterRules,
  credentialRules,
  serviceParamRule,
  connectRules,
  aiGenerateRules,
  aiAnalyzeRules,
};
