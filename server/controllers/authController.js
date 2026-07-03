/**
 * Auth Controller — 双轨制登录
 *
 * POST /api/auth/uid   — UID 基础模式（免密，读公开红心歌单）
 * POST /api/auth/token — Token 深度模式（MUSIC_U 注入，全功能解锁）
 */
const netease = require('../services/netease');
const { getUserPlaylists, loadUserArsenal } = require('../services/playlistService');

// ── UID 基础模式 ──

async function loginByUid(req, res, next) {
  try {
    const { uid } = req.body;

    if (!uid || !String(uid).trim()) {
      return res.status(400).json({ error: 'UID 必填' });
    }

    const cleanUid = String(uid).trim();

    // 获取用户歌单列表（公开数据，不需要登录态）
    const playlists = await getUserPlaylists(cleanUid);

    if (!playlists || playlists.length === 0) {
      return res.status(404).json({
        error: '未找到该用户的公开歌单',
        code: 'NO_PLAYLISTS',
      });
    }

    // 找红心歌单（第一个通常是红心歌单，或 specialType === 5）
    const heartPlaylist = playlists.find(p => p.name?.includes('喜欢')) || playlists[0];

    // 加载该用户的红心歌单为弹药库
    await loadUserArsenal(heartPlaylist.id);

    // 获取用户昵称（从歌单创建者获取）
    const nickname = heartPlaylist.creator?.nickname || `UID:${cleanUid}`;

    res.json({
      success: true,
      uid: cleanUid,
      nickname,
      playlistId: heartPlaylist.id,
      playlistName: heartPlaylist.name,
      playlistCount: heartPlaylist.trackCount,
      mode: 'basic',
    });
  } catch (err) {
    console.error('[Auth/UID] 失败:', err.message);
    next(err);
  }
}

// ── Token 深度模式 ──

async function loginByToken(req, res, next) {
  try {
    const { token } = req.body;

    if (!token || !String(token).trim()) {
      return res.status(400).json({ error: 'MUSIC_U Token 必填' });
    }

    const cleanToken = String(token).trim();

    // 验证 Token 有效性
    const accountRes = await netease.api('/user/account', { cookie: cleanToken });
    const profile = accountRes?.profile;
    const account = accountRes?.account;

    if (!profile || !account) {
      return res.status(401).json({
        error: 'Token 无效或已过期',
        code: 'INVALID_TOKEN',
      });
    }

    // 保存 Cookie 到 .cookie 文件（对齐 Mineradio 方案）
    netease.saveCookie(cleanToken);

    // 加载该用户的红心歌单
    const uid = String(account.id);
    try {
      const playlists = await getUserPlaylists(uid);
      const heartPlaylist = playlists.find(p => p.name?.includes('喜欢')) || playlists[0];
      if (heartPlaylist) {
        await loadUserArsenal(heartPlaylist.id);
      }
    } catch (e) {
      console.warn('[Auth/Token] 加载歌单失败（非致命）:', e.message);
    }

    res.json({
      success: true,
      uid,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl || '',
      vipType: account.vipType || 0,
      mode: 'full',
    });
  } catch (err) {
    console.error('[Auth/Token] 失败:', err.message);
    next(err);
  }
}

module.exports = { loginByUid, loginByToken };
