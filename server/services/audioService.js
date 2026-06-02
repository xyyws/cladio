/**
 * 模块一：核心播放引擎
 *
 * getPlayableTrack(songId) — 并行获取元数据 + 播放直链。
 * 使用 netease.js 统一接口（自动带 SVIP Cookie）。
 *
 * ⚠️ URL 有时效性，绝不能缓存到数据库。
 */
const netease = require('./netease');

/**
 * 接收歌曲 ID，返回完整可播放对象
 * @param {string|number} songId
 * @returns {Promise<{ songId, title, artist, coverUrl, audioUrl, playable: true }>}
 */
async function getPlayableTrack(songId) {
  const [detail, urlInfo] = await Promise.all([
    netease.getSongDetail(songId),
    netease.getSongUrl(songId),
  ]);

  if (!detail) {
    return { songId: String(songId), error: '歌曲不存在', playable: false };
  }

  const coverUrl = detail.cover || detail.coverUrl || '';

  if (!urlInfo || !urlInfo.url) {
    return {
      songId: String(songId),
      title: detail.name,
      artist: detail.artists,
      artistId: detail.artistId,
      coverUrl: coverUrl ? coverUrl.replace(/^http:\/\//, 'https://') : coverUrl,
      error: '版权受限或需 VIP',
      playable: false,
    };
  }

  return {
    songId: String(songId),
    title: detail.name,
    artist: detail.artists,
    artistId: detail.artistId,
    coverUrl: coverUrl ? coverUrl.replace(/^http:\/\//, 'https://') : coverUrl,
    audioUrl: urlInfo.url ? urlInfo.url.replace(/^http:\/\//, 'https://') : urlInfo.url,
    playable: true,
  };
}

/**
 * 批量获取可播放歌曲
 * @param {string[]} songIds
 * @returns {Promise<Array>}
 */
async function getPlayableTracks(songIds) {
  const results = await Promise.allSettled(
    songIds.map(id => getPlayableTrack(id)),
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      songId: String(songIds[i]),
      error: r.reason?.message || '获取失败',
      playable: false,
    };
  });
}

module.exports = { getPlayableTrack, getPlayableTracks };
