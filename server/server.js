const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const router = require('./routes/router');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ── Static: TTS 缓存音频 ──
// /audio/* 路径：正式 TTS 文件（带 MD5 哈希名）
app.use('/audio', express.static(path.join(__dirname, 'cache')));
// 根路径直接访问：mock-speech.mp3 等调试文件
app.use(express.static(path.join(__dirname, 'cache')));

// ── Routes ──
app.use('/api', router);

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'claudio-bff', timestamp: Date.now() });
});

// ── Error handling (must be last) ──
app.use(errorHandler);

// ── Start ──
app.listen(config.port, () => {
  console.log(`[Claudio BFF] listening on http://localhost:${config.port}`);
});
