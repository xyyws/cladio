/**
 * 评论服务 — 获取歌曲热门评论
 *
 * 供 buildDJPrompt() 使用，将网友热评注入 DJ 串场词。
 */
const netease = require('./netease');

/**
 * 获取歌曲的热门评论
 * @param {string} songId - 歌曲 ID
 * @param {number} limit - 评论数量（默认 3）
 * @returns {Promise<Array<{ user, content, likedCount }>>}
 */
async function getTopComments(songId, limit = 3) {
  try {
    const comments = await netease.getHotComments(songId, limit);
    return comments.filter(c => c.content && c.content.length > 5);
  } catch (err) {
    console.warn(`[Comment] 获取歌曲 ${songId} 评论失败:`, err.message);
    return [];
  }
}

/**
 * 为多首歌曲批量获取评论
 * @param {string[]} songIds
 * @param {number} limitPerSong - 每首歌取几条评论
 * @returns {Promise<Map<string, Array>>}
 */
async function getCommentsForPlaylist(songIds, limitPerSong = 1) {
  const results = await Promise.allSettled(
    songIds.map(id => getTopComments(id, limitPerSong)),
  );

  const map = new Map();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      map.set(songIds[i], r.value);
    }
  });
  return map;
}

module.exports = { getTopComments, getCommentsForPlaylist };
