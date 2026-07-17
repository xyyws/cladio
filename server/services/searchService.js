/**
 * 模块三：用户主动交互（搜索点歌）
 *
 * 支持文字搜索，预留语音搜索接口。
 * 内置语义关键词扩展（模糊词 → 具体搜索词）。
 */
const netease = require('./netease');
const { expandKeywords } = require('./recommendEngine');

/**
 * 文字搜索（带语义扩展）
 * @param {string} keywords - 搜索关键词
 * @param {object} opts - { limit, offset }
 * @returns {Promise<Array>} 搜索结果
 */
async function searchSongs(keywords, opts = {}) {
  if (!keywords || typeof keywords !== 'string') {
    throw new Error('keywords 必填');
  }

  const limit = opts.limit || 10;

  // 1. 直接搜索
  let results = await netease.search(keywords.trim(), {
    limit,
    offset: opts.offset || 0,
    type: 1,
  });

  // 2. 结果不足时，语义扩展搜索
  if (results.length < 3) {
    const expanded = expandKeywords(keywords.trim());
    for (const kw of expanded) {
      if (kw === keywords.trim()) continue; // 跳过原词
      try {
        const extra = await netease.search(kw, { limit, type: 1 });
        results.push(...extra);
      } catch (_) {}
      if (results.length >= limit) break;
    }
  }

  // 去重
  const seen = new Set();
  results = results.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return results.slice(0, limit).map(s => ({
    id: s.id,
    name: s.name,
    artists: s.artists,
    album: s.album,
    cover: s.cover,
    duration: s.duration,
  }));
}

module.exports = { searchSongs };
