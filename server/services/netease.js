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

// Cookie 文件路径（优先级：环境变量 > .cookie 动态 > cookie.txt 静态）
const DYNAMIC_COOKIE_PATH = path.join(__dirname, '..', '.cookie');
const STATIC_COOKIE_PATH = path.join(__dirname, '..', '..', 'NeteaseCloudMusicApiBackup-main', 'cookie.txt');
let NETEASE_COOKIE = process.env.NETEASE_COOKIE || '';
let _cookieLastRead = 0;
const COOKIE_RELOAD_MS = 30000;

/**
 * 加载 Cookie — 优先级：环境变量 > .cookie（QR/Token 登录） > cookie.txt（SVIP 静态）
 */
function loadCookie() {
  if (process.env.NETEASE_COOKIE) return; // 环境变量最高优先

  // 1. 读取 QR/Token 登录保存的 .cookie
  try {
    const dynamic = fs.readFileSync(DYNAMIC_COOKIE_PATH, 'utf-8').trim();
    if (dynamic) {
      NETEASE_COOKIE = dynamic;
      _cookieLastRead = Date.now();
      return;
    }
  } catch (_) {}

  // 2. 降级读取静态 cookie.txt
  try {
    const static_ = fs.readFileSync(STATIC_COOKIE_PATH, 'utf-8').trim();
    if (static_) {
      NETEASE_COOKIE = static_;
      _cookieLastRead = Date.now();
      console.log('[NetEase] Cookie 已从 cookie.txt 加载');
      return;
    }
  } catch (_) {}

  console.warn('[NetEase] 未找到 Cookie，将以游客身份访问');
}

/**
 * 保存 Cookie（QR/Token 登录成功后调用）
 * 同时更新内存和 .cookie 文件
 */
function saveCookie(cookie) {
  if (!cookie) return;
  NETEASE_COOKIE = cookie;
  _cookieLastRead = Date.now();
  try {
    fs.writeFileSync(DYNAMIC_COOKIE_PATH, cookie, 'utf-8');
    console.log('[NetEase] Cookie 已保存到 .cookie');
  } catch (err) {
    console.warn('[NetEase] Cookie 保存失败:', err.message);
  }
}

/**
 * 清除 Cookie（登出时调用）
 */
function clearCookie() {
  NETEASE_COOKIE = '';
  _cookieLastRead = 0;
  try { fs.unlinkSync(DYNAMIC_COOKIE_PATH); } catch (_) {}
  console.log('[NetEase] Cookie 已清除');
}

// 初始加载
loadCookie();

function refreshCookie() {
  if (Date.now() - _cookieLastRead > COOKIE_RELOAD_MS) {
    loadCookie();
  }
}

/**
 * 获取当前登录状态
 */
function getLoginStatus() {
  return {
    loggedIn: !!NETEASE_COOKIE,
    hasCookie: !!NETEASE_COOKIE,
    source: process.env.NETEASE_COOKIE ? 'env' : (fs.existsSync(DYNAMIC_COOKIE_PATH) ? 'qr_login' : 'static'),
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function api(endpoint, params = {}, retryCount = 0) {
  const base = config.netease.apiBase;

  // 每次请求前检查 cookie 是否需要刷新
  refreshCookie();

  // 注入 SVIP Cookie（作为查询参数，但不覆盖已有的 per-request cookie）
  if (NETEASE_COOKIE && !params.cookie) {
    params.cookie = NETEASE_COOKIE;
  }

  const qs = new URLSearchParams(params).toString();
  const url = `${base}${endpoint}${qs ? '?' + qs : ''}`;

  // 构建 Cookie header（NETEASE_COOKIE 已包含 MUSIC_U= 前缀）
  const cookieHeader = NETEASE_COOKIE || '';

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/',
        'Cookie': cookieHeader,
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

// 音质配置
const QUALITY_LEVELS = {
  standard: { br: 128000, label: '标准', desc: '128kbps' },
  higher:   { br: 192000, label: '较高', desc: '192kbps' },
  exhigh:   { br: 320000, label: '极高', desc: '320kbps' },
  lossless: { br: 999000, label: '无损', desc: 'FLAC' },
};
let _currentQuality = 'exhigh'; // 默认极高

function setQuality(level) {
  if (QUALITY_LEVELS[level]) {
    _currentQuality = level;
    console.log(`[NetEase] 音质切换: ${QUALITY_LEVELS[level].label} (${QUALITY_LEVELS[level].desc})`);
  }
}

function getQuality() {
  return { level: _currentQuality, ...QUALITY_LEVELS[_currentQuality] };
}

async function getSongUrl(songId) {
  const br = QUALITY_LEVELS[_currentQuality].br;
  const json = await api('/song/url', { id: String(songId), br });
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

// ── 红心歌曲列表 ──

async function getLikedIds(uid) {
  try {
    const json = await api('/likelist', { uid: String(uid) });
    return json?.ids || [];
  } catch (err) {
    console.warn('[NetEase] 获取红心列表失败:', err.message);
    return [];
  }
}

/**
 * 获取红心歌曲详情列表
 * likelist API 返回的 ID 顺序 = 收藏时间倒序（最新收藏在前）
 *
 * @param {string} uid
 * @param {object} opts - { timeRange: 'all'|'newest'|'oldest', limit }
 * @returns {Promise<Array>} 歌曲列表
 */
async function getLikedSongs(uid, opts = {}) {
  const ids = await getLikedIds(uid);
  if (ids.length === 0) return [];

  // 根据时间范围截取
  let selectedIds;
  const limit = opts.limit || 10;
  if (opts.timeRange === 'oldest') {
    // 很久之前收藏 → 取列表末尾（最早收藏的）
    selectedIds = ids.slice(-limit).reverse();
  } else if (opts.timeRange === 'newest') {
    // 最近收藏 → 取列表开头
    selectedIds = ids.slice(0, limit);
  } else {
    // 全部 → 随机取
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    selectedIds = shuffled.slice(0, limit);
  }

  // 批量获取歌曲详情
  try {
    const detailJson = await api('/song/detail', { ids: selectedIds.join(',') });
    const songs = detailJson?.songs || [];
    return songs.map(s => ({
      id: s.id,
      name: s.name,
      artists: (s.ar || []).map(a => a.name).join(' / '),
      album: s.al?.name || '',
      cover: (s.al?.picUrl || '').replace(/^http:\/\//, 'https://'),
      duration: s.dt || 0,
      pop: s.pop || 0,
    }));
  } catch (err) {
    console.warn('[NetEase] 获取歌曲详情失败:', err.message);
    return selectedIds.map(id => ({ id, name: '', artists: '' }));
  }
}

async function search(keywords, { limit = 20, offset = 0, type = 1 } = {}) {
  const json = await api('/search', { keywords, limit, offset, type });
  const songs = json?.result?.songs || [];

  return songs.map(s => ({
    id: s.id,
    name: s.name,
    artists: (s.ar || s.artists || []).map(a => a.name).join(' / '),
    album: s.al?.name || s.album?.name || '',
    cover: (s.al?.picUrl || s.album?.picUrl || '').replace(/^http:\/\//, 'https://'),
    duration: s.dt || s.duration || 0,
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

// ── 运行时更新 Cookie（Token 注入用） ──

function setCookie(cookie) {
  NETEASE_COOKIE = cookie;
  console.log('[NetEase] Cookie 已通过 Token 注入更新');
}

module.exports = {
  api,
  getSongDetail,
  getSongUrl,
  getLikedIds,
  getLikedSongs,
  setQuality,
  getQuality,
  QUALITY_LEVELS,
  getPlaylistDetail,
  search,
  getHotComments,
  getLyrics,
  like,
  playlistTracks,
  getArtistDesc,
  login,
  setCookie,
  saveCookie,
  clearCookie,
  getLoginStatus,
  getDailyRecommendPlaylists,
  getDailyRecommendSongs,
  getSimilarPlaylists,
  getSimilarSongs,
};
