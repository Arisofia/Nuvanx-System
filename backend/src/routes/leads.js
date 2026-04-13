'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const leadModel = require('../models/lead');
const { handleValidationErrors } = require('../utils/validators');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

const leadRules = [
  body('name').optional().trim().isLength({ max: 255 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().trim().isLength({ max: 64 }),
  body('source').optional().trim().isLength({ max: 64 }),
  body('stage').optional().isIn(leadModel.STAGES).withMessage('Invalid stage'),
  body('revenue').optional().isNumeric(),
  body('notes').optional().trim().isLength({ max: 2000 }),
];

/** GET /api/leads */
router.get('/', (req, res) => {
  const { stage, source } = req.query;
  const leads = leadModel.findByUser(req.user.id, { stage, source });
  res.json({ success: true, leads, total: leads.length });
});

/** GET /api/leads/:id */
router.get('/:id', (req, res) => {
  const lead = leadModel.findById(req.params.id, req.user.id);
  if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
  res.json({ success: true, lead });
});

/** POST /api/leads */
router.post('/', leadRules, handleValidationErrors, (req, res, next) => {
  try {
    const lead = leadModel.create(req.user.id, req.body);
    logger.info('Lead created', { userId: req.user.id, leadId: lead.id });
    res.status(201).json({ success: true, lead });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/leads/:id */
router.put(
  '/:id',
  [...leadRules, param('id').isUUID()],
  handleValidationErrors,
  (req, res, next) => {
    try {
      const lead = leadModel.update(req.params.id, req.user.id, req.body);
      if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
      res.json({ success: true, lead });
    } catch (err) {
      next(err);
    }
  },
);

/** DELETE /api/leads/:id */
router.delete('/:id', [param('id').isUUID(), handleValidationErrors], (req, res) => {
  const deleted = leadModel.remove(req.params.id, req.user.id);
  if (!deleted) return res.status(404).json({ success: false, message: 'Lead not found' });
  res.json({ success: true, message: 'Lead deleted' });
});

module.exports = router;
