/**
 * POST /api/feedback
 * 用户对当前歌曲/串场词的反馈
 */
async function postFeedback(req, res, next) {
  try {
    const { songId, type, comment } = req.body;

    if (!songId || !type) {
      return res.status(400).json({ error: 'songId 和 type 字段必填' });
    }

    const validTypes = ['like', 'dislike', 'skip', 'favorite'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type 必须是: ${validTypes.join(', ')}` });
    }

    // TODO: 持久化反馈，更新用户偏好模型
    res.json({
      status: 'recorded',
      songId,
      type,
      comment: comment || null,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { postFeedback };
