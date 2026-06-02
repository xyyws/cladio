/**
 * TTS.js — 语音合成模块（mimo-v2.5-tts）
 *
 * generateSpeech(text) — 将串场词转化为可播放的音频 URL。
 *
 * 调用方式：OpenAI 兼容的 chat/completions 接口
 *   - user 消息 = 语气/风格指令
 *   - assistant 消息 = 要朗读的文本
 *   - 返回 base64 编码的 wav 音频
 *
 * 特性：
 *   - 带时间戳的文件名防缓存
 *   - 自动清理旧的 dj_speech_*.mp3 文件
 *   - Mock 模式降级
 *   - 重试机制
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 60000;

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isMockMode() {
  return process.env.MOCK_TTS === 'true' || !config.tts.apiKey;
}

// ── 防缓存文件名 ──

function getTimestampFilename(ext = 'wav') {
  return `dj_speech_${Date.now()}.${ext}`;
}

function getAudioUrlPath(filename) {
  return `/audio/${filename}`;
}

// ── 自动清理旧文件 ──

function cleanOldSpeechFiles() {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const oldFiles = files.filter(f => f.startsWith('dj_speech_') && (f.endsWith('.mp3') || f.endsWith('.wav')));

    for (const file of oldFiles) {
      const filePath = path.join(CACHE_DIR, file);
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
    }

    if (oldFiles.length > 0) {
      console.log(`[TTS] 已清理 ${oldFiles.length} 个旧语音文件`);
    }
  } catch (err) {
    console.warn('[TTS] 清理旧文件失败:', err.message);
  }
}

// ── Mock 模式 ──

function getMockSpeechUrl(text) {
  const mockFile = 'mock-speech.wav';
  const mockPath = path.join(CACHE_DIR, mockFile);

  if (!fs.existsSync(mockPath)) {
    // 最小合法 WAV: 44 字节 header + 1 byte data
    const wavHeader = Buffer.alloc(44);
    // RIFF header
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36, 4);
    wavHeader.write('WAVE', 8);
    // fmt chunk
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20); // PCM
    wavHeader.writeUInt16LE(1, 22); // mono
    wavHeader.writeUInt32LE(22050, 24); // sample rate
    wavHeader.writeUInt32LE(22050, 28); // byte rate
    wavHeader.writeUInt16LE(1, 32); // block align
    wavHeader.writeUInt16LE(8, 34); // bits per sample
    // data chunk
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(1, 40);
    const mockWav = Buffer.concat([wavHeader, Buffer.from([0x80])]);
    fs.writeFileSync(mockPath, mockWav);
    console.log('[TTS] 已创建 mock-speech.wav 占位文件');
  }

  console.log(`[TTS] Mock 模式，文本: "${text.slice(0, 30)}..."`);
  return {
    url: `/${mockFile}`,
    filename: mockFile,
    cached: false,
    mock: true,
  };
}

// ── mimo-v2.5-tts API 调用 ──

async function callMimoTTS(text, retryCount = 0) {
  const { apiKey, baseUrl, model, voice, style } = config.tts;

  cleanOldSpeechFiles();

  const filename = getTimestampFilename('wav');
  const filePath = path.join(CACHE_DIR, filename);

  try {
    const res = await axios.post(`${baseUrl}/chat/completions`, {
      model,
      messages: [
        { role: 'user', content: style },
        { role: 'assistant', content: text },
      ],
      audio: { format: 'wav', voice },
    }, {
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    // 响应格式：choices[0].message.audio.data 为 base64 编码的音频
    const audioData = res.data?.choices?.[0]?.message?.audio?.data;
    if (!audioData) {
      throw new Error('响应中无音频数据');
    }

    const audioBuffer = Buffer.from(audioData, 'base64');
    fs.writeFileSync(filePath, audioBuffer);

    const sizeKB = Math.round(audioBuffer.length / 1024);
    console.log(`[TTS] 合成成功: ${filename} (${sizeKB} KB)`);

    return {
      url: getAudioUrlPath(filename),
      filename,
      cached: false,
      mock: false,
    };
  } catch (err) {
    const errMsg = err.response?.data
      ? `mimo TTS 返回 ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`
      : err.message;

    if (retryCount < MAX_RETRIES) {
      console.warn(`[TTS] 合成失败 (${errMsg})，第 ${retryCount + 1} 次重试...`);
      await sleep(RETRY_DELAY_MS * (retryCount + 1));
      return callMimoTTS(text, retryCount + 1);
    }
    throw new Error(`TTS 合成失败 (已重试 ${MAX_RETRIES} 次): ${errMsg}`);
  }
}

// ── 主方法 ──

/**
 * 将文本转化为可播放的音频 URL
 *
 * @param {string} text - 串场词文本
 * @returns {Promise<{ url: string, filename: string, cached: boolean, mock: boolean }>}
 */
async function generateSpeech(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('generateSpeech: text 参数必填且为非空字符串');
  }

  if (isMockMode()) {
    return getMockSpeechUrl(text);
  }

  return callMimoTTS(text);
}

module.exports = { generateSpeech };
