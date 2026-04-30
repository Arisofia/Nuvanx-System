const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'), false);
  },
}));
app.use(express.json());

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
app.listen(port, () => {
  console.log(`Backend placeholder server listening on port ${port}`);
});
