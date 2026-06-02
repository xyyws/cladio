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

const router = Router();

// 1. POST /api/chat     — 用户与主播对话
router.post('/chat', chatController.postChat);

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

module.exports = router;
