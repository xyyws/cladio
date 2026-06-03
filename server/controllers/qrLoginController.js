/**
 * QR Code Login Controller
 * POST /api/qr/create - 生成二维码
 * GET /api/qr/check/:key - 检查扫码状态
 */
const netease = require('../services/netease');

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

    // code: 800=过期, 801=等待扫码, 802=已扫码待确认, 803=登录成功
    res.json({
      code: result?.code || 0,
      message: result?.message || '',
      cookie: result?.cookie || null,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createQR, checkQR };
