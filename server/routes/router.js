const { Router } = require('express');
const chatController = require('../controllers/chatController');
const contextController = require('../controllers/contextController');
const historyController = require('../controllers/historyController');
const feedbackController = require('../controllers/feedbackController');
const ttsController = require('../controllers/ttsController');
const nextController = require('../controllers/nextController');
const searchController = require('../controllers/searchController');
const trackController = require('../controllers/trackController');
const arsenalController = require('../controllers/arsenalController');
const commentsController = require('../controllers/commentsController');
const lyricsController = require('../controllers/lyricsController');
const artistController = require('../controllers/artistController');
const likeController = require('../controllers/likeController');
const authController = require('../controllers/authController');
const qrLoginController = require('../controllers/qrLoginController');
const memoryController = require('../controllers/memoryController');

const router = Router();

// 1. POST /api/chat     — 用户与主播对话
router.post('/chat', chatController.postChat);

// 1b. POST /api/chat/stream — SSE 流式聊天（Agent 活动实时推送）
router.post('/chat/stream', chatController.postChatStream);

// 2. GET  /api/context  — 获取当前 6 维上下文原始数据
router.get('/context', contextController.getContext);

// 3. GET  /api/history  — 听歌历史
router.get('/history', historyController.getHistory);

// 4. POST /api/feedback — 用户对当前歌曲/串场词的反馈
router.post('/feedback', feedbackController.postFeedback);

// 5. POST /api/tts      — 将 say 文本转为语音
router.post('/tts', ttsController.postTts);

// 6. GET  /api/next     — 核心编排：选歌 → 上下文 → Claude → 音频 → TTS
router.get('/next', nextController.getNext);

// 7. GET  /api/search   — 文字搜索点歌
router.get('/search', searchController.getSearch);

// 8. GET  /api/track/:id — 获取单首歌曲可播放信息（实时 URL）
router.get('/track/:id', trackController.getTrack);

// 9. GET  /api/arsenal      — 获取弹药库状态
router.get('/arsenal', arsenalController.getArsenalStatus);

// 10. POST /api/arsenal      — 换弹夹（切换歌单）
router.post('/arsenal', arsenalController.switchArsenal);

// 10.5. GET /api/arsenal/play — 获取弹药库可播放歌曲
router.get('/arsenal/play', arsenalController.getArsenalPlaylist);

// 10.6. GET /api/arsenal/tracks — 获取指定歌单歌曲列表
router.get('/arsenal/tracks', arsenalController.getPlaylistTrackList);

// 11. GET /api/comments/:songId — 获取歌曲热门评论
router.get('/comments/:songId', commentsController.getComments);

// 12. GET /api/lyrics/:songId — 获取歌曲歌词
router.get('/lyrics/:songId', lyricsController.getLyrics);

// 13. GET /api/artist/:artistId — 获取歌手百科
router.get('/artist/:artistId', artistController.getArtistWiki);

// 14. POST /api/like — 红心/取消红心歌曲
router.post('/like', likeController.likeSong);

// 15. GET /api/tts/:id — 轮询 TTS 生成状态
router.get('/tts/:id', chatController.getTtsStatus);

// 16. POST /api/auth/uid — UID 基础模式登录
router.post('/auth/uid', authController.loginByUid);

// 17. POST /api/auth/token — Token 深度模式登录
router.post('/auth/token', authController.loginByToken);

// 18. POST /api/qr/create — 生成二维码
router.post('/qr/create', qrLoginController.createQR);

// 19. GET /api/qr/check/:key — 轮询扫码状态
router.get('/qr/check/:key', qrLoginController.checkQR);

// 20. GET /api/login/status — 查询登录状态
router.get('/login/status', qrLoginController.getLoginStatus);

// 21. POST /api/logout — 登出
router.post('/logout', qrLoginController.logout);

// ═══ 聊天记忆系统 ═══

// 18. GET  /api/memory/chat — 获取聊天历史
router.get('/memory/chat', memoryController.getChat);

// 19. POST /api/memory/chat — 保存聊天消息
router.post('/memory/chat', memoryController.postChat);

// 20. DEL  /api/memory/chat — 清空聊天历史
router.delete('/memory/chat', memoryController.deleteChat);

// 21. GET  /api/memory/prefs — 获取用户记忆/偏好
router.get('/memory/prefs', memoryController.getPrefs);

// 22. POST /api/memory/prefs — 保存用户记忆
router.post('/memory/prefs', memoryController.postPrefs);

// 23. DEL  /api/memory/prefs/:id — 删除用户记忆
router.delete('/memory/prefs/:id', memoryController.deletePrefs);

// 24. GET  /api/memory/context — 获取记忆上下文
router.get('/memory/context', memoryController.getContext);

// 25. GET  /api/quality — 获取当前音质
router.get('/quality', (_req, res) => {
  const netease = require('../services/netease');
  const q = netease.getQuality();
  res.json({ status: 200, data: q });
});

// 26. POST /api/quality — 设置音质
router.post('/quality', (req, res) => {
  const netease = require('../services/netease');
  const { level } = req.body;
  if (!level || !netease.QUALITY_LEVELS[level]) {
    return res.status(400).json({ status: 400, error: { message: '无效音质等级' } });
  }
  netease.setQuality(level);
  const q = netease.getQuality();
  res.json({ status: 200, data: q });
});

// 27. GET /api/likelist — 获取用户红心歌曲 ID 列表
router.get('/likelist', async (req, res) => {
  const netease = require('../services/netease');
  const uid = req.query.uid;
  if (!uid) return res.status(400).json({ status: 400, error: { message: 'uid 必填' } });
  const ids = await netease.getLikedIds(uid);
  res.json({ status: 200, data: { ids, count: ids.length } });
});

// 28. GET /api/liked — 获取红心歌曲详情（按收藏时间）
router.get('/liked', async (req, res) => {
  const netease = require('../services/netease');
  const uid = req.query.uid;
  const timeRange = req.query.timeRange || 'all';
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  if (!uid) return res.status(400).json({ status: 400, error: { message: 'uid 必填' } });
  const songs = await netease.getLikedSongs(uid, { timeRange, limit });
  res.json({ status: 200, data: { songs, timeRange, count: songs.length } });
});

// 29. POST /api/llm — 轻量 LLM 代理（不走 Agent 流程，供 Python 服务调用）
router.post('/llm', async (req, res) => {
  try {
    const { prompt, temperature = 0.1, max_tokens = 500 } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt 必填' });

    const config = require('../config');
    const OpenAI = require('openai');
    const client = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl,
      timeout: 30000,
    });

    const response = await client.chat.completions.create({
      model: config.llm.model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens,
    });

    const reply = response.choices[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
