/**
 * PlaylistService.js — 私有化弹药库
 *
 * 从网易云 API 拉取用户歌单，缓存到内存 + SQLite，
 * 作为 AI 主播的"备选歌曲池"。
 */
const netease = require('./netease');
const stateDB = require('./stateDB');

// ── 内存缓存 ──
let _playlistCache = null;  // Map<playlistId, { name, tracks[] }>
let _allTracksCache = null; // Array<{ id, name, artists, album, coverUrl }>
let _lastFetch = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟缓存

/**
 * 清除弹药库缓存（切换歌单后调用）
 */
function clearArsenalCache() {
  _allTracksCache = null;
  _lastFetch = 0;
  console.log('[Playlist] 弹药库缓存已清除');
}

// ── 用户配置（从 .env 读取） ──
const USER_UID = process.env.NETEASE_UID || '1376158004';
const HEART_PLAYLIST_ID = process.env.NETEASE_PLAYLIST_ID || '2107763308';

/**
 * 获取用户的歌单列表
 * @param {string} uid
 * @returns {Promise<Array<{ id, name, trackCount }>>}
 */
async function getUserPlaylists(uid = USER_UID) {
  const json = await netease.api('/user/playlist', { uid, limit: 30 });
  const playlists = json?.playlist || [];

  return playlists.map(p => ({
    id: p.id,
    name: p.name,
    trackCount: p.trackCount || 0,
    coverUrl: p.coverImgUrl || '',
  }));
}

/**
 * 获取歌单内所有歌曲
 * @param {string} playlistId
 * @returns {Promise<Array<{ id, name, artists, album, coverUrl }>>}
 */
async function getPlaylistTracks(playlistId) {
  // playlist/track/all 一次最多返回 1000 首，需要分页
  const allTracks = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const json = await netease.api('/playlist/track/all', {
      id: String(playlistId),
      limit,
      offset,
    });

    const songs = json?.songs || [];
    if (songs.length === 0) break;

    allTracks.push(...songs.map(s => ({
      id: s.id,
      name: s.name,
      artists: (s.ar || []).map(a => a.name).join(' / '),
      album: s.al?.name || '',
      coverUrl: s.al?.picUrl || '',
    })));

    if (songs.length < limit) break;
    offset += limit;
  }

  return allTracks;
}

/**
 * 加载弹药库（带缓存）
 * @param {boolean} forceRefresh - 强制刷新缓存
 * @returns {Promise<Array<{ id, name, artists, album, coverUrl }>>}
 */
async function loadArsenal(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && _allTracksCache && (now - _lastFetch) < CACHE_TTL_MS) {
    console.log(`[Playlist] 使用缓存: ${_allTracksCache.length} 首歌`);
    return _allTracksCache;
  }

  // 优先从 SQLite 读取（包含所有已导入的歌单）
  const fromDb = loadFromDB();
  if (fromDb.length > 0) {
    _allTracksCache = fromDb;
    _lastFetch = now;
    console.log(`[Playlist] 从数据库加载: ${fromDb.length} 首歌`);
    return fromDb;
  }

  // SQLite 为空时，从网易云拉取默认歌单
  console.log(`[Playlist] 正在拉取红心歌单 ${HEART_PLAYLIST_ID}...`);

  try {
    const tracks = await getPlaylistTracks(HEART_PLAYLIST_ID);
    _allTracksCache = tracks;
    _lastFetch = now;

    console.log(`[Playlist] 弹药库加载完成: ${tracks.length} 首歌`);

    // 同步写入 SQLite
    syncToDB(tracks).catch(err => {
      console.warn('[Playlist] 同步到数据库失败:', err.message);
    });

    return tracks;
  } catch (err) {
    console.error('[Playlist] 拉取失败:', err.message);
    return [];
  }
}

/**
 * 从弹药库中随机选取 N 首歌
 * @param {number} count
 * @param {string[]} excludeIds - 排除的歌曲 ID
 * @returns {Promise<Array>}
 */
async function pickRandom(count = 5, excludeIds = []) {
  const arsenal = await loadArsenal();
  const excludeSet = new Set(excludeIds);

  const candidates = arsenal.filter(t => !excludeSet.has(String(t.id)));

  // Fisher-Yates 洗牌
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, count);
}

/**
 * 按关键词搜索弹药库
 * @param {string} keyword
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function searchArsenal(keyword, limit = 5) {
  const arsenal = await loadArsenal();
  const kw = (keyword || '').toLowerCase();

  return arsenal
    .filter(t =>
      (t.name || '').toLowerCase().includes(kw) ||
      (t.artists || '').toLowerCase().includes(kw) ||
      (t.album || '').toLowerCase().includes(kw)
    )
    .slice(0, limit);
}

/**
 * 异步同步到 SQLite
 */
async function syncToDB(tracks) {
  const { upsertSong } = stateDB;
  for (const t of tracks) {
    upsertSong(String(t.id), {
      title: t.name,
      artist: t.artists,
      album: t.album,
      coverUrl: t.coverUrl,
    });
  }
  console.log(`[Playlist] 已同步 ${tracks.length} 首歌到数据库`);
}

/**
 * 从 SQLite 降级读取
 */
function loadFromDB() {
  try {
    const db = stateDB.getDb();
    const rows = db.prepare('SELECT song_id AS id, title AS name, artist AS artists, album, cover_url AS coverUrl FROM songs LIMIT 5000').all();
    console.log(`[Playlist] 从数据库降级读取: ${rows.length} 首歌`);
    return rows;
  } catch (_) {
    return [];
  }
}

/**
 * 加载指定用户的红心歌单为弹药库
 * @param {string} playlistId - 歌单 ID
 * @returns {Promise<Array>}
 */
async function loadUserArsenal(playlistId) {
  console.log(`[Playlist] 加载用户歌单 ${playlistId}...`);
  const tracks = await getPlaylistTracks(playlistId);

  if (!tracks || tracks.length === 0) {
    console.warn(`[Playlist] 歌单 ${playlistId} 为空`);
    return [];
  }

  // 清空旧缓存，替换为用户歌单
  _allTracksCache = tracks;
  _lastFetch = Date.now();

  // 同步写入 SQLite
  syncToDB(tracks).catch(err => {
    console.warn('[Playlist] 同步到数据库失败:', err.message);
  });

  console.log(`[Playlist] 用户歌单加载完成: ${tracks.length} 首歌`);
  return tracks;
}

module.exports = {
  getUserPlaylists,
  getPlaylistTracks,
  loadArsenal,
  loadUserArsenal,
  pickRandom,
  searchArsenal,
  clearArsenalCache,
  USER_UID,
  HEART_PLAYLIST_ID,
};
