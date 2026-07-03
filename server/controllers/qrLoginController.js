/**
 * QR Code Login Controller
 *
 * 对齐 Mineradio 方案：
 *   - POST /api/qr/create  — 生成二维码
 *   - GET  /api/qr/check/:key — 轮询扫码状态
 *   - GET  /api/login/status   — 查询登录态
 *   - POST /api/logout         — 登出
 *
 * 扫码成功后自动保存 Cookie 到 .cookie 文件，后续 API 调用自动使用。
 */
const netease = require('../services/netease');
const { getUserPlaylists, loadUserArsenal } = require('../services/playlistService');

// 生成二维码
async function createQR(req, res, next) {
  try {
    const timestamp = Date.now();

    // Step 1: 获取 unikey
    const keyRes = await netease.api('/login/qr/key', { timestamp });
    const unikey = keyRes?.data?.unikey;

    if (!unikey) {
      return res.status(500).json({ error: '获取二维码 key 失败' });
    }

    // Step 2: 生成二维码图片
    const qrRes = await netease.api('/login/qr/create', {
      key: unikey,
      qrimg: true,
      timestamp,
    });

    res.json({
      key: unikey,
      qrimg: qrRes?.data?.qrimg || null,
      qrurl: qrRes?.data?.qrurl || null,
    });
  } catch (err) {
    next(err);
  }
}

// 检查扫码状态
async function checkQR(req, res, next) {
  try {
    const { key } = req.params;

    if (!key) {
      return res.status(400).json({ error: 'key 必填' });
    }

    const result = await netease.api('/login/qr/check', {
      key,
      timestamp: Date.now(),
    });

    const code = result?.code || 0;

    // 803 = 登录成功 → 保存 Cookie + 加载歌单
    if (code === 803 && result?.cookie) {
      // 保存 Cookie 到 .cookie 文件（对齐 Mineradio saveCookie 逻辑）
      netease.saveCookie(result.cookie);

      // 尝试加载用户红心歌单
      try {
        const accountRes = await netease.api('/user/account', {});
        const uid = String(accountRes?.account?.id || '');
        if (uid) {
          const playlists = await getUserPlaylists(uid);
          const heartPlaylist = playlists.find(p => p.name?.includes('喜欢')) || playlists[0];
          if (heartPlaylist) {
            await loadUserArsenal(heartPlaylist.id);
            console.log(`[QR Login] 已加载用户 ${uid} 的红心歌单 (${heartPlaylist.trackCount} 首)`);
          }
        }
      } catch (e) {
        console.warn('[QR Login] 加载歌单失败（非致命）:', e.message);
      }

      return res.json({
        code,
        message: result?.message || '登录成功',
        cookie: result.cookie,
        loggedIn: true,
      });
    }

    // 800=过期, 801=等待扫码, 802=已扫码待确认
    res.json({
      code,
      message: result?.message || '',
    });
  } catch (err) {
    next(err);
  }
}

// 查询登录状态
async function getLoginStatus(req, res, next) {
  try {
    const status = netease.getLoginStatus();

    if (!status.loggedIn) {
      return res.json({ loggedIn: false });
    }

    // 有 Cookie 时查询用户信息
    try {
      const accountRes = await netease.api('/user/account', {});
      const profile = accountRes?.profile;
      const account = accountRes?.account;

      if (profile && account) {
        return res.json({
          loggedIn: true,
          uid: String(account.id),
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl || '',
          vipType: account.vipType || 0,
          source: status.source,
        });
      }
    } catch (_) {}

    // Cookie 存在但查询失败（可能过期）
    return res.json({
      loggedIn: true,
      pendingProfile: true,
      source: status.source,
    });
  } catch (err) {
    next(err);
  }
}

// 登出
async function logout(req, res, next) {
  try {
    // 尝试调用网易云登出 API（忽略错误）
    try {
      await netease.api('/logout', {});
    } catch (_) {}

    // 清除本地 Cookie
    netease.clearCookie();

    res.json({ success: true, message: '已登出' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createQR, checkQR, getLoginStatus, logout };
