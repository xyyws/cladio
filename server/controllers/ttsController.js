/**
 * POST /api/tts
 * 将文本转为语音（ElevenLabs）
 */
const { generateSpeech } = require('../services/tts');

async function postTts(req, res, next) {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text 字段必填，且为字符串' });
    }

    const result = await generateSpeech(text);
    res.json({
      status: 'ok',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { postTts };
