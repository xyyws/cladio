/**
 * GET /api/comments/:songId — 获取歌曲热门评论
 */
const netease = require('../services/netease');

async function getComments(req, res, next) {
  try {
    const { songId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 15, 50);

    if (!songId) {
      return res.status(400).json({ error: 'songId 必填' });
    }

    const comments = await netease.getHotComments(songId, limit);

    res.json({
      comments: comments.map(c => ({
        id: `${songId}-${c.user}-${c.time}`,
        content: c.content,
        nickname: c.user,
        likedCount: c.likedCount,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getComments };
