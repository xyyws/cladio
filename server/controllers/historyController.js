/**
 * GET /api/history
 * 返回听歌历史
 */
async function getHistory(_req, res, next) {
  try {
    // TODO: 从持久化存储读取
    res.json({
      total: 2,
      items: [
        { songId: '347230', title: '晴天', artist: '周杰伦', playedAt: Date.now() - 7200000, feedback: null },
        { songId: '186016', title: '起风了', artist: '买辣椒也用券', playedAt: Date.now() - 3600000, feedback: 'like' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHistory };
