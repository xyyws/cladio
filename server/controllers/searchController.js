const { searchSongs } = require('../services/searchService');

/**
 * GET /api/search?keywords=xxx&limit=10
 */
async function getSearch(req, res, next) {
  try {
    const { keywords, limit, offset } = req.query;

    if (!keywords) {
      return res.status(400).json({ error: 'keywords 参数必填' });
    }

    const results = await searchSongs(keywords, {
      limit: parseInt(limit) || 10,
      offset: parseInt(offset) || 0,
    });

    res.json({ keywords, total: results.length, results });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSearch };
