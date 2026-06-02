/**
 * NetEase Cloud Music API — 低层客户端
 * 所有网易云 API 调用统一走这里，带重试和超时。
 *
 * 端点参考: https://github.com/neteasecloudmusicapienhanced/api-enhanced
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// 读取网易云 Cookie（SVIP 登录态）
const COOKIE_PATH = path.join(__dirname, '..', '..', 'NeteaseCloudMusicApiBackup-main', 'cookie.txt');
let NETEASE_COOKIE = process.env.NETEASE_COOKIE || '';

if (!NETEASE_COOKIE) {
  try {
    NETEASE_COOKIE = fs.readFileSync(COOKIE_PATH, 'utf-8').trim();
    console.log('[NetEase] Cookie 已从文件加载');
  } catch (_) {
    console.warn('[NetEase] 未找到 cookie.txt，将以游客身份访问');
  }
} else {
  console.log('[NetEase] Cookie 已从环境变量加载');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function api(endpoint, params = {}, retryCount = 0) {
  const base = config.netease.apiBase;

  // 注入 SVIP Cookie（作为查询参数）
  if (NETEASE_COOKIE) {
    params.cookie = NETEASE_COOKIE;
  }

  const qs = new URLSearchParams(params).toString();
  const url = `${base}${endpoint}${qs ? '?' + qs : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * (retryCount + 1));
      return api(endpoint, params, retryCount + 1);
    }
    throw new Error(`NetEase ${endpoint} 失败 (已重试 ${MAX_RETRIES} 次): ${err.message}`);
  }
}

// ── 缓存 ──
const { cacheGet, cacheSet } = require('./stateDB');

// ── 歌曲详情 ──

async function getSongDetail(songId) {
  const cacheKey = `song_detail:${songId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const json = await api('/song/detail', { ids: String(songId) });
  const song = json?.songs?.[0];
  if (!song) return null;

  const result = {
    id: song.id,
    name: song.name,
    artists: (song.ar || []).map(a => a.name).join(' / '),
    artistId: song.ar?.[0]?.id || null,
    album: song.al?.name || '',
    cover: (song.al?.picUrl || '').replace(/^http:\/\//, 'https://'),
    duration: song.dt || 0,
    pop: song.pop || 0,
  };

  cacheSet(cacheKey, result, 3600); // 缓存 1 小时
  return result;
}

// ── 播放地址（实时获取，不缓存） ──

async function getSongUrl(songId) {
  const json = await api('/song/url', { id: String(songId), br: 320000 });
  const data = json?.data?.[0];

  if (!data || !data.url) return null;

  return {
    url: data.url,
    br: data.br || 128000,
    size: data.size || 0,
    type: data.type || 'mp3',
  };
}

// ── 歌单详情 ──

async function getPlaylistDetail(playlistId) {
  const json = await api('/playlist/detail', { id: String(playlistId) });
  const pl = json?.playlist;
  if (!pl) return null;

  return {
    id: pl.id,
    name: pl.name,
    trackIds: (pl.trackIds || []).map(t => t.id),
    trackCount: pl.trackIds?.length || 0,
  };
}

// ── 搜索 ──

async function search(keywords, { limit = 20, offset = 0, type = 1 } = {}) {
  const json = await api('/search', { keywords, limit, offset, type });
  const songs = json?.result?.songs || [];

  return songs.map(s => ({
    id: s.id,
    name: s.name,
    artists: (s.ar || []).map(a => a.name).join(' / '),
    album: s.al?.name || '',
    cover: (s.al?.picUrl || '').replace(/^http:\/\//, 'https://'),
    duration: s.dt || 0,
    pop: s.pop || 0,
  }));
}

// ── 热门评论 ──

async function getHotComments(songId, limit = 5) {
  const cacheKey = `comments:${songId}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const json = await api('/comment/hot', { id: String(songId), type: 0, limit });
  const comments = json?.hotComments || [];

  const result = comments.map(c => ({
    user: c.user?.nickname || '匿名',
    content: c.content || '',
    likedCount: c.likedCount || 0,
    time: c.time || 0,
  }));

  cacheSet(cacheKey, result, 1800); // 缓存 30 分钟
  return result;
}

// ── 歌词 ──

async function getLyrics(songId) {
  const cacheKey = `lyrics:${songId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const json = await api('/lyric', { id: String(songId) });
  const lrc = json?.lrc?.lyric || '';
  const tlyric = json?.tlyric?.lyric || '';

  // 元数据关键词（制作人员信息）
  const META_KEYWORDS = ['作词', '作曲', '编曲', '制作人', '和声', '吉他', '贝斯', '鼓', '录音', '混音', '助理', '母带', '弦乐', '钢琴', 'Program'];

  // 解析时间戳 → 秒数数组（过滤掉元数据行）
  const parseTimestamps = (text) =>
    text
      .split('\n')
      .filter(line => !META_KEYWORDS.some(kw => line.includes(kw)))
      .map(line => {
        const match = line.match(/\[(\d+):(\d+)\.(\d+)\]/);
        if (!match) return null;
        return parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / 100;
      })
      .filter(t => t !== null && t > 0)
      .sort((a, b) => a - b);

  // 清洗时间轴，只保留纯文本
  const cleanLrc = (text) =>
    text
      .split('\n')
      .map(line => line.replace(/\[\d+:\d+\.\d+\]/g, '').trim())
      .filter(line => line.length > 0)
      .join('\n');

  const result = {
    lyric: cleanLrc(lrc),
    tlyric: tlyric ? cleanLrc(tlyric) : null,
    timestamps: parseTimestamps(lrc),
  };

  cacheSet(cacheKey, result, 3600); // 缓存 1 小时
  return result;
}

// ── 红心/取消红心 ──

async function like(songId, likeVal = true) {
  const json = await api('/like', { id: String(songId), like: likeVal });
  return { code: json?.code, success: json?.code === 200 };
}

// ── 歌单增删歌曲 ──

async function playlistTracks(op, pid, tracks) {
  const json = await api('/playlist/tracks', {
    op,
    pid: String(pid),
    tracks: String(tracks),
  });
  return { code: json?.code, success: json?.code === 200, message: json?.body?.message || '' };
}

// ── 歌手百科 ──

async function getArtistDesc(artistId) {
  const json = await api('/artist/desc', { id: String(artistId) });
  return {
    briefDesc: json?.briefDesc || '',
    introduction: (json?.introduction || []).map(i => ({
      ti: i.ti || '',
      txt: i.txt || '',
    })),
  };
}

// ── 登录 ──

async function login(phone, password, captcha) {
  const params = { phone };
  if (captcha) {
    params.captcha = captcha;
  } else if (password) {
    params.password = password;
  }

  const endpoint = captcha ? '/login/cellphone' : '/login/cellphone';
  const json = await api(endpoint, params);

  if (json?.code === 200 && json?.cookie) {
    // 更新全局 Cookie
    NETEASE_COOKIE = json.cookie;
    console.log('[NetEase] 登录成功，Cookie 已更新');
    return {
      success: true,
      userId: json.account?.id,
      nickname: json.profile?.nickname,
      vipType: json.account?.vipType,
    };
  }

  return { success: false, message: json?.msg || '登录失败' };
}

// ── 每日推荐歌单 ──

async function getDailyRecommendPlaylists() {
  const json = await api('/recommend/resource');
  const playlists = json?.recommend || [];

  return playlists.slice(0, 5).map(p => ({
    id: p.id,
    name: p.name,
    copywriter: p.copywriter || '',
    playcount: p.playcount || 0,
    picUrl: (p.picUrl || '').replace(/^http:\/\//, 'https://'),
  }));
}

// ── 每日推荐歌曲 ──

async function getDailyRecommendSongs() {
  const json = await api('/recommend/songs');
  const songs = json?.data?.dailySongs || [];

  return songs.slice(0, 10).map(s => ({
    id: s.id,
    name: s.name,
    artists: (s.ar || []).map(a => a.name).join(' / '),
    album: s.al?.name || '',
    reason: s.reason || '',
  }));
}

// ── 相似歌单 ──

async function getSimilarPlaylists(songId) {
  const json = await api('/simi/playlist', { songid: String(songId) });
  const playlists = json?.playlists || [];

  return playlists.slice(0, 5).map(p => ({
    id: p.id,
    name: p.name,
    playcount: p.playcount || 0,
    creator: p.creator?.nickname || '',
  }));
}

// ── 相似歌曲 ──

async function getSimilarSongs(songId) {
  const json = await api('/simi/song', { id: String(songId) });
  const songs = json?.songs || [];

  return songs.slice(0, 10).map(s => ({
    id: s.id,
    name: s.name,
    artists: (s.ar || []).map(a => a.name).join(' / '),
    album: s.al?.name || '',
  }));
}

module.exports = {
  api,
  getSongDetail,
  getSongUrl,
  getPlaylistDetail,
  search,
  getHotComments,
  getLyrics,
  like,
  playlistTracks,
  getArtistDesc,
  login,
  getDailyRecommendPlaylists,
  getDailyRecommendSongs,
  getSimilarPlaylists,
  getSimilarSongs,
};
