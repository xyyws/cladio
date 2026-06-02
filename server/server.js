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
const fs = require('fs');
let NCM_DIR = path.resolve(__dirname, 'NeteaseCloudMusicApiBackup-main');
console.log('[NetEase API] 尝试路径1:', NCM_DIR, '存在:', fs.existsSync(NCM_DIR));
if (!fs.existsSync(NCM_DIR)) {
  NCM_DIR = path.resolve(__dirname, '..', 'NeteaseCloudMusicApiBackup-main');
  console.log('[NetEase API] 尝试路径2:', NCM_DIR, '存在:', fs.existsSync(NCM_DIR));
}
const NCM_SERVER = path.join(NCM_DIR, 'server.js');
console.log('[NetEase API] 最终路径:', NCM_SERVER, '存在:', fs.existsSync(NCM_SERVER));
if (fs.existsSync(NCM_SERVER)) {
  try {
    const ncmServer = require(NCM_SERVER);
    console.log('[NetEase API] 模块加载成功');
    ncmServer.consturctServer().then(ncmApp => {
      if (ncmApp) {
        app.use(ncmApp);
        console.log('[NetEase API] 已嵌入主服务');
      }
    }).catch(err => {
      console.warn('[NetEase API] 嵌入失败:', err.message);
    });
  } catch (err) {
    console.warn('[NetEase API] 加载失败:', err.message);
  }
} else {
  console.warn('[NetEase API] 文件不存在，跳过嵌入');
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
