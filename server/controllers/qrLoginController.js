/**
 * QR Code Login Controller
 *
 * 直接调用 NeteaseCloudMusicApi 函数（对齐 Mineradio 方案），
 * 不走 HTTP 代理，避免参数丢失和设备风控。
 */
const {
  login_qr_key,
  login_qr_create,
  login_qr_check,
  login_status,
  user_account,
  user_playlist,
} = require('../../NeteaseCloudMusicApiBackup-main/node_modules/NeteaseCloudMusicApi');

const netease = require('../services/netease');
const { getUserPlaylists, loadUserArsenal } = require('../services/playlistService');

// 生成二维码
async function createQR(req, res, next) {
  try {
    const timestamp = Date.now();

    // Step 1: 获取 unikey（对齐 Mineradio: 直接调函数）
    const keyRes = await login_qr_key({ timestamp });
    const unikey = keyRes?.body?.data?.unikey;

    if (!unikey) {
      return res.status(500).json({ error: '获取二维码 key 失败' });
    }

    // Step 2: 生成二维码图片（对齐 Mineradio: qrimg: true）
    const qrRes = await login_qr_create({ key: unikey, qrimg: true, timestamp });
    const d = qrRes?.body?.data;

    res.json({
      key: unikey,
      qrimg: d?.qrimg || null,
      qrurl: d?.qrurl || null,
    });
  } catch (err) {
    next(err);
  }
}

// 检查扫码状态（对齐 Mineradio: noCookie: true + cookie 重试）
async function checkQR(req, res, next) {
  try {
    const { key } = req.params;

    if (!key) {
      return res.status(400).json({ error: 'key 必填' });
    }

    // 对齐 Mineradio: 先用 noCookie: true 请求
    let r = await login_qr_check({ key, noCookie: true, timestamp: Date.now() });
    let body = r?.body || {};
    let code = Number(body.code || r?.code || 0);
    let msg = body.message || r?.message || '';
    let cookie = readCookieFromResponse(r);

    // 803 成功但没拿到 cookie → 重试（不带 noCookie）
    if (code === 803 && !cookie) {
      try {
        const retry = await login_qr_check({ key, timestamp: Date.now() });
        const retryCookie = readCookieFromResponse(retry);
        if (retryCookie) {
          r = retry;
          body = retry.body || body;
          code = Number(body.code || retry.code || code);
          msg = body.message || retry.message || msg;
          cookie = retryCookie;
        }
      } catch (retryErr) {
        console.warn('[QR Login] cookie retry failed:', retryErr.message);
      }
    }

    // 803 = 登录成功 → 保存 Cookie + 加载歌单
    if (code === 803) {
      if (cookie) {
        netease.saveCookie(cookie);
        console.log('[QR Login] Cookie 已保存');
      }

      // 尝试加载用户红心歌单
      try {
        const accountRes = await user_account({ cookie: cookie || '' });
        const uid = String(accountRes?.body?.account?.id || '');
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
        message: msg || '登录成功',
        cookie,
        loggedIn: true,
        nickname: body.profile?.nickname || body.nickname || '网易云用户',
        avatarUrl: body.profile?.avatarUrl || body.avatarUrl || '',
      });
    }

    // 800=过期, 801=等待扫码, 802=已扫码待确认
    res.json({ code, message: msg });
  } catch (err) {
    next(err);
  }
}

/**
 * 从响应中读取 Cookie（对齐 Mineradio readCookieFromResponse）
 */
function readCookieFromResponse(resp) {
  const candidates = [
    resp?.cookie,
    resp?.body?.cookie,
    resp?.body?.data?.cookie,
    resp?.body?.data?.cookies,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (Array.isArray(c) && c.length > 0) return c.join('; ').trim();
  }
  return '';
}

// 查询登录状态
async function getLoginStatus(req, res, next) {
  try {
    const status = netease.getLoginStatus();

    if (!status.loggedIn) {
      return res.json({ loggedIn: false });
    }

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

    return res.json({ loggedIn: true, pendingProfile: true, source: status.source });
  } catch (err) {
    next(err);
  }
}

// 登出
async function logout(req, res, next) {
  try {
    netease.clearCookie();
    res.json({ success: true, message: '已登出' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createQR, checkQR, getLoginStatus, logout };
