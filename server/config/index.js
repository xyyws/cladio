require('dotenv').config();

module.exports = {
  port: process.env.PORT || 8080,

  // ── LLM（OpenAI 兼容接口） ──
  llm: {
    apiKey: process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.LLM_BASE_URL || 'https://api.mimo.one/v1',
    model: process.env.LLM_MODEL || 'mimo-v2.5-pro',
  },

  // ── 网易云音乐 API ──
  netease: {
    apiBase: process.env.NETEASE_API_BASE || 'http://localhost:3000',
  },

  // ── TTS（mimo-v2.5-tts） ──
  tts: {
    apiKey: process.env.TTS_API_KEY || process.env.LLM_API_KEY,
    baseUrl: process.env.TTS_BASE_URL || process.env.LLM_BASE_URL || 'https://api.xiaomimimo.com/v1',
    model: process.env.TTS_MODEL || 'mimo-v2.5-tts',
    voice: process.env.TTS_VOICE || '白桦',
    style: process.env.TTS_STYLE || 'Warm, friendly, conversational — like a radio DJ introducing the next song. Natural pace, clear pronunciation.',
  },

  // ── 飞书 API ──
  feishu: {
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  },

  // ── OpenWeather ──
  openweather: {
    apiKey: process.env.OPENWEATHER_API_KEY,
    city: process.env.OPENWEATHER_CITY || 'Shanghai',
  },
};
