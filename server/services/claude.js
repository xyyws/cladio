/**
 * Claude.js — 大模型适配器（OpenAI 兼容接口）
 *
 * askBrain(prompt) — 向 mimo-v2.5-pro 发送请求，强制解析 JSON 响应。
 * 核心防御：Markdown 清洗 → JSON 解析 → 字段校验 → 重试。
 */
const axios = require('axios');
const config = require('../config');

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000;

const REQUIRED_FIELDS = ['say', 'play', 'reason', 'segue'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Axios 实例 ──

function getClient() {
  const { apiKey, baseUrl } = config.llm;

  if (!apiKey) {
    throw new Error('LLM_API_KEY 未配置，请在 .env 中设置');
  }

  return axios.create({
    baseURL: baseUrl,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

// ── System Prompt ──

const SYSTEM_PROMPT = `你是 Claudio，一位有品味的 AI 电台主播。

你的风格：
- 温暖、文艺、有洞察力，像老朋友在深夜陪你聊天
- 你会讲歌曲背后的故事：创作背景、歌手经历、专辑年代
- 偶尔引用网易云热评，但要自然融入串场词
- 前奏响起时点出歌曲的灵魂，曲终时用有余韵的话过渡

【重要规则】
- 你的回复必须是一个纯粹的 JSON 对象
- 不要输出任何思考过程、解释、分析或 Markdown
- 不要以"首先""让我""好的"等词开头
- 直接以 { 开头，以 } 结尾

JSON 格式：
{"say":"串场词，自然口语化，3-5句话，有温度和画面感","play":["歌曲ID_1","歌曲ID_2"],"reason":"选歌逻辑","segue":"crossfade:3000"}`;

// ── Markdown 清洗 ──

function stripMarkdown(text) {
  return text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

// ── JSON 强制解析 ──

function extractJson(text) {
  const cleaned = stripMarkdown(text);

  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  const braceMatch = cleaned.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch (_) {}
  }

  return null;
}

// ── 字段校验 ──

function validateResponse(data) {
  if (typeof data !== 'object' || data === null) {
    return ['响应不是有效的 JSON 对象'];
  }

  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (!(field in data)) {
      errors.push(`缺少必填字段: ${field}`);
    }
  }

  if (typeof data.say !== 'string' || data.say.trim().length === 0) {
    errors.push('say 必须为非空字符串');
  }

  if (!Array.isArray(data.play)) {
    errors.push('play 必须为数组');
  }

  if (typeof data.reason !== 'string') {
    errors.push('reason 必须为字符串');
  }

  if (typeof data.segue !== 'string') {
    errors.push('segue 必须为字符串');
  }

  return errors;
}

// ── 核心方法 ──

/**
 * 向大模型发送 prompt，返回结构化 JSON
 *
 * @param {string} prompt - 完整的 prompt 字符串
 * @param {number} [retryCount=0] - 当前重试次数
 * @returns {Promise<{ say: string, play: string[], reason: string, segue: string }>}
 */
async function askBrain(prompt, retryCount = 0) {
  const client = getClient();

  // ── 发送请求（OpenAI 兼容格式） ──
  const response = await client.post('/chat/completions', {
    model: config.llm.model,
    max_tokens: 1024,
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  });

  // mimo 兼容：content 可能为空，内容在 reasoning_content 里
  const message = response.data?.choices?.[0]?.message;
  const rawText = message?.content || message?.reasoning_content || '';

  console.log(`[LLM] 原始响应 (${rawText.length} chars): ${rawText.slice(0, 100)}...`);

  // ── JSON 解析 ──
  const parsed = extractJson(rawText);

  if (!parsed) {
    if (retryCount < MAX_RETRIES) {
      console.warn(`[LLM] JSON 解析失败，第 ${retryCount + 1} 次重试...`);
      await sleep(RETRY_DELAY_MS);
      return askBrain(prompt, retryCount + 1);
    }
    throw new Error(`BRAIN_PARSING_FAILED: 无法从响应中解析 JSON（已重试 ${MAX_RETRIES} 次）。原始文本: ${rawText.slice(0, 200)}`);
  }

  // ── 字段校验 ──
  const errors = validateResponse(parsed);

  if (errors.length > 0) {
    if (retryCount < MAX_RETRIES) {
      console.warn(`[LLM] 响应校验失败 (${errors.join('; ')})，第 ${retryCount + 1} 次重试...`);
      await sleep(RETRY_DELAY_MS);
      return askBrain(prompt, retryCount + 1);
    }
    throw new Error(`BRAIN_PARSING_FAILED: 响应格式不合规（已重试 ${MAX_RETRIES} 次）。错误: ${errors.join('; ')}`);
  }

  return parsed;
}

/**
 * 简化版：只校验 say 字段，用于 DJ 介绍生成
 */
async function askBrainSimple(prompt, retryCount = 0) {
  const client = getClient();

  const response = await client.post('/chat/completions', {
    model: config.llm.model,
    max_tokens: 256,
    temperature: 0.7,
    messages: [
      { role: 'system', content: '你是 Claudio，一位有品味的 AI 电台 DJ。直接返回 JSON，不要输出思考过程。' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  });

  const message = response.data?.choices?.[0]?.message;
  const rawText = message?.content || message?.reasoning_content || '';

  console.log(`[LLM] 介绍响应 (${rawText.length} chars): ${rawText.slice(0, 100)}`);

  const parsed = extractJson(rawText);

  if (!parsed || typeof parsed.say !== 'string' || !parsed.say.trim()) {
    if (retryCount < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
      return askBrainSimple(prompt, retryCount + 1);
    }
    throw new Error('BRAIN_PARSING_FAILED: 无法解析介绍文本');
  }

  return { say: parsed.say };
}

module.exports = { askBrain, askBrainSimple };
