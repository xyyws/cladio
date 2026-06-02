/**
 * GET /api/artist/:artistId — 获取歌手百科信息
 */
const netease = require('../services/netease');

async function getArtistWiki(req, res, next) {
  try {
    const { artistId } = req.params;

    if (!artistId) {
      return res.status(400).json({ error: 'artistId 必填' });
    }

    const wiki = await netease.getArtistDesc(artistId);

    res.json({
      briefDesc: wiki.briefDesc || '',
      introduction: wiki.introduction || [],
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getArtistWiki };
