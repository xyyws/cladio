/**
 * POST /api/arsenal — 换弹夹
 *
 * 接收前端传来的歌单 ID，拉取该歌单所有歌曲，
 * 替换当前弹药库。
 */
const { loadArsenal, getPlaylistTracks, getUserPlaylists } = require('../services/playlistService');

// 运行时覆盖的歌单 ID（优先级高于 .env）
let _activePlaylistId = null;

function getActivePlaylistId() {
  return _activePlaylistId || process.env.NETEASE_PLAYLIST_ID || '2107763308';
}

/**
 * POST /api/arsenal
 * Body: { playlistId: "123456" }
 */
async function switchArsenal(req, res, next) {
  try {
    const { playlistId } = req.body;

    if (!playlistId) {
      return res.status(400).json({
        status: 400,
        error: { message: 'playlistId 必填', code: 'MISSING_PLAYLIST_ID' },
      });
    }

    // 拉取歌单歌曲
    console.log(`[Arsenal] 导入歌单 ${playlistId}...`);
    const tracks = await getPlaylistTracks(playlistId);

    if (!tracks || tracks.length === 0) {
      return res.status(404).json({
        status: 404,
        error: { message: `歌单 ${playlistId} 不存在或为空`, code: 'PLAYLIST_EMPTY' },
      });
    }

    // 写入 SQLite（UPSERT，不会重复）
    const { upsertSong } = require('../services/stateDB');
    let added = 0;
    for (const t of tracks) {
      upsertSong(String(t.id), {
        title: t.name,
        artist: t.artists,
        album: t.album,
        coverUrl: t.coverUrl,
      });
      added++;
    }

    // 更新活跃歌单 ID
    _activePlaylistId = String(playlistId);

    // 查询总数
    const { getDb } = require('../services/stateDB');
    const totalCount = getDb().prepare('SELECT COUNT(*) AS c FROM songs').get().c;

    res.json({
      status: 200,
      data: {
        playlistId: _activePlaylistId,
        imported: added,
        totalTracks: totalCount,
        message: `导入 ${added} 首歌，曲库总计 ${totalCount} 首`,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/arsenal — 获取当前弹药库状态
 */
async function getArsenalStatus(_req, res, next) {
  try {
    const playlistId = getActivePlaylistId();

    // 获取用户歌单列表
    let playlists = [];
    try {
      playlists = await getUserPlaylists();
    } catch (_) {}

    // 获取当前弹药库大小
    let trackCount = 0;
    try {
      const tracks = await loadArsenal();
      trackCount = tracks.length;
    } catch (_) {}

    res.json({
      status: 200,
      data: {
        activePlaylistId: playlistId,
        trackCount,
        userPlaylists: playlists.map(p => ({
          id: p.id,
          name: p.name,
          trackCount: p.trackCount,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/arsenal/play — 获取弹药库可播放歌曲列表
 * 返回前 N 首歌曲的播放信息，用于直接播放
 */
async function getArsenalPlaylist(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const tracks = await loadArsenal();

    if (!tracks || tracks.length === 0) {
      return res.status(404).json({
        status: 404,
        error: { message: '弹药库为空', code: 'EMPTY_ARSENAL' },
      });
    }

    // 取前 N 首
    const selected = tracks.slice(0, limit);

    // 获取可播放 URL
    const { getPlayableTracks } = require('../services/audioService');
    const playable = await getPlayableTracks(selected.map(t => String(t.id)));

    const playlist = playable.map((t, i) => ({
      songId: t.songId,
      title: t.title || selected[i]?.name || null,
      artist: t.artist || selected[i]?.artists || null,
      coverUrl: t.coverUrl || selected[i]?.coverUrl || null,
      audioUrl: t.audioUrl || null,
      playable: t.playable !== undefined ? t.playable : !!t.audioUrl,
    }));

    res.json({
      status: 200,
      data: { playlist },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { switchArsenal, getArsenalStatus, getActivePlaylistId, getArsenalPlaylist };
