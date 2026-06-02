/**
 * GET /api/lyrics/:songId — 获取歌曲歌词（带时间戳）
 */
const netease = require('../services/netease');

// 元数据关键词
const META_KEYWORDS = ['作词', '作曲', '编曲', '制作人', '和声', '吉他', '贝斯', '鼓', '录音', '混音', '助理', '母带', '弦乐', '钢琴', 'Program', 'Lyrics', 'Composer', 'Producer'];

async function getLyrics(req, res, next) {
  try {
    const { songId } = req.params;

    if (!songId) {
      return res.status(400).json({ error: 'songId 必填' });
    }

    // 直接调用网易云 API 获取原始歌词（带时间戳）
    const json = await netease.api('/lyric', { id: String(songId) });
    const rawLrc = json?.lrc?.lyric || '';

    // 解析带时间戳的歌词行
    const lines = rawLrc
      .split('\n')
      .map(line => {
        const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
        if (!match) return null;
        const time = parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / 1000;
        const text = match[4].trim();
        if (!text || META_KEYWORDS.some(kw => text.includes(kw))) return null;
        return { time: Math.round(time * 100) / 100, text };
      })
      .filter(Boolean);

    res.json({ lines });
  } catch (err) {
    next(err);
  }
}

module.exports = { getLyrics };
