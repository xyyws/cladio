/**
 * 模块三：用户主动交互（搜索点歌）
 *
 * 支持文字搜索，预留语音搜索接口。
 */
const netease = require('./netease');

/**
 * 文字搜索
 * @param {string} keywords - 搜索关键词
 * @param {object} opts - { limit, offset }
 * @returns {Promise<Array>} 搜索结果
 */
async function searchSongs(keywords, opts = {}) {
  if (!keywords || typeof keywords !== 'string') {
    throw new Error('keywords 必填');
  }

  const results = await netease.search(keywords.trim(), {
    limit: opts.limit || 10,
    offset: opts.offset || 0,
    type: 1,
  });

  return results.map(s => ({
    id: s.id,
    name: s.name,
    artists: s.artists,
    album: s.album,
    cover: s.cover,
    duration: s.duration,
  }));
}

module.exports = { searchSongs };
