const { getPlayableTrack } = require('../services/audioService');

/**
 * GET /api/track/:id
 * 获取单首歌曲的完整可播放信息（实时获取 URL，不缓存）
 */
async function getTrack(req, res, next) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: '歌曲 ID 必填' });
    }

    const track = await getPlayableTrack(id);
    res.json(track);
  } catch (err) {
    next(err);
  }
}

module.exports = { getTrack };
