const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const router = require('./routes/router');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// ── Security Headers ──
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.removeHeader('X-Frame-Options');
  next();
});

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ── Static: TTS 缓存音频 ──
app.use('/audio', express.static(path.join(__dirname, 'cache')));
app.use(express.static(path.join(__dirname, 'cache')));

// ── Routes ──
app.use('/api', router);

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'claudio-bff', timestamp: Date.now() });
});

// ── Error handling (must be last) ──
app.use(errorHandler);

// ── 启动（支持 Railway PORT） ──
const PORT = process.env.PORT || config.port;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Claudio BFF] listening on http://0.0.0.0:${PORT}`);
});
