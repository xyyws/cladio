/**
 * POST /api/like — 红心/取消红心歌曲
 */
const netease = require('../services/netease');

async function likeSong(req, res, next) {
  try {
    const { songId, like = true } = req.body;

    if (!songId) {
      return res.status(400).json({ error: 'songId 必填' });
    }

    const result = await netease.like(songId, like);

    res.json({
      success: result.success,
      songId,
      liked: like,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { likeSong };
