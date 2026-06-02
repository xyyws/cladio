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

// ── 内嵌网易云 API ──
const NCM_PATH = path.join(__dirname, '..', 'NeteaseCloudMusicApiBackup-main');
try {
  const ncmServer = require(path.join(NCM_PATH, 'server'));
  // serveNcmApi 返回 Promise<app>，用 port:0 阻止它监听端口
  ncmServer.serveNcmApi({ port: 0, host: '' }).then(ncmApp => {
    if (ncmApp && ncmApp.use) {
      app.use(ncmApp);
      console.log('[NetEase API] 已嵌入主服务');
    }
  }).catch(err => {
    console.warn('[NetEase API] 嵌入失败:', err.message);
  });
} catch (err) {
  console.warn('[NetEase API] 加载失败:', err.message);
}

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
