const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const defaultLocalOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) ||
        (allowedOrigins.length === 0 && defaultLocalOrigins.has(origin))) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
};

const app = express();

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());

// CSRF protection via custom-header check (OWASP "Custom Request Headers" pattern).
// Browsers cannot set arbitrary headers on cross-origin requests without a CORS preflight,
// so requiring this header on state-changing methods blocks cross-site form/script attacks.
// Safe methods (GET, HEAD, OPTIONS) are exempt. JSON API clients must send
// the header "X-Requested-With: XMLHttpRequest" (or any non-empty value) on
// POST / PUT / PATCH / DELETE requests.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use((req, res, next) => {
  if (!SAFE_METHODS.has(req.method) && !req.headers['x-requested-with']) {
    return res.status(403).json({ error: 'CSRF check failed: missing X-Requested-With header' });
  }
  next();
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Nuvanx backend placeholder is running. Primary API is served via Supabase functions.',
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

const port = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Backend placeholder server listening on port ${port}`);
  });
}

module.exports = app;
