/**
 * POST /api/chat — AI Agent 对话引擎
 *
 * 使用大模型原生 Function Calling 能力：
 *   1. 用户消息 + 工具定义 → 发给大模型
 *   2. 大模型决定调用哪些工具
 *   3. 执行工具，将结果返回给大模型
 *   4. 大模型生成最终回复（流式输出）
 *   5. 返回给前端：回复文本 + 工具调用日志 + 推荐歌曲
 *
 * TTS 异步化：
 *   - 聊天立即返回文字 + 歌曲
 *   - TTS 后台生成，前端通过 /api/tts/:id 轮询获取
 *
 * 最多循环 5 轮（防止无限调用）
 */
const axios = require('axios');
const config = require('../config');
const { getEnvironmentSnapshot } = require('../services/context');

// TTS 异步缓存（5 分钟过期）
const ttsCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of ttsCache) {
    if (val.expires < now) ttsCache.delete(key);
  }
}, 60000);
const { getPlayableTracks } = require('../services/audioService');
const { generateSpeech } = require('../services/tts');
const { TOOL_DEFINITIONS, executeTool } = require('../services/tools');
const netease = require('../services/netease');

const MAX_AGENT_LOOPS = 4;

const SYSTEM_PROMPT = `你是 Claudio，一位有品味的 AI 电台主播。

你的能力：
- 搜索并播放歌曲
- 根据天气、时段、用户心情推荐音乐
- 获取歌曲评论，在串场词中引用
- 从用户的私人歌库中挑选歌曲

行为准则：
1. 当用户指定歌曲时，用 search_song 搜索一次即可，不需要多次搜索
2. 拿到搜索结果后，立即调用 set_playlist 提交歌曲 ID，不要做多余操作
3. 当用户只是聊天或说"随便来几首"，用 pick_from_arsenal 从歌库随机挑选
4. 回复要温暖自然，像朋友聊天，不要太长（1-3 句话）
5. 你必须在第 2 次回复时就调用 set_playlist，不要拖延
6. 每次回复都必须包含 set_playlist 工具调用，这是强制要求`;

// ── set_playlist 是一个"虚拟工具"，用于让大模型提交最终结果 ──
const SET_PLAYLIST_TOOL = {
  type: 'function',
  function: {
    name: 'set_playlist',
    description: '设置最终推荐的歌曲列表。必须在决策完成后调用此工具提交结果。',
    parameters: {
      type: 'object',
      properties: {
        reply: {
          type: 'string',
          description: '给用户的回复文字（1-3 句话，温暖自然）',
        },
        song_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '推荐的歌曲 ID 列表（1-5 首）',
        },
        reason: {
          type: 'string',
          description: '推荐理由（内部记录用）',
        },
      },
      required: ['reply', 'song_ids'],
    },
  },
};

// ── Axios 客户端 ──

function getClient() {
  return axios.create({
    baseURL: config.llm.baseUrl,
    timeout: 30000,
    headers: {
      'Authorization': `Bearer ${config.llm.apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

// ── Agent 主循环 ──

async function runAgent(userMessage, history) {
  const allTools = [...TOOL_DEFINITIONS, SET_PLAYLIST_TOOL];
  const activityLog = []; // 记录 Agent 的每一步操作

  // ── 预搜索：从用户消息中提取关键词搜索歌曲 ──
  const keywords = userMessage
    .replace(/播放|来一首|想听|来首|放一首|放首|给我来|点一首|点首|推荐|搜索|搜|的歌|歌|音乐|的/g, '')
    .trim();

  let preSearchResults = [];
  if (keywords && keywords.length >= 1) {
    try {
      preSearchResults = await netease.search(keywords, { limit: 10 });
      console.log(`[Agent] 预搜索 "${keywords}": ${preSearchResults.length} 首`);
    } catch (err) {
      console.warn('[Agent] 预搜索失败:', err.message);
    }
  }

  // 组装初始消息
  const env = await getEnvironmentSnapshot().catch(() => ({}));
  const contextInfo = [
    `当前时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    `天气: ${env.weather || '未知'}`,
    `时段: ${env.dayPhase || '未知'}`,
  ].join('；');

  // 如果有预搜索结果，注入到 prompt 中
  let searchHint = '';
  if (preSearchResults.length > 0) {
    const songList = preSearchResults.map(s =>
      `- ${s.id}: "${s.name}" - ${s.artists}`
    ).join('\n');
    searchHint = `\n\n用户搜索结果（已找到，直接使用这些歌曲 ID）:\n${songList}`;
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + `\n\n环境信息: ${contextInfo}${searchHint}` },
  ];

  // 加入对话历史
  if (Array.isArray(history)) {
    for (const msg of history.slice(-10)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: userMessage });

  // Agent 循环
  for (let loop = 0; loop < MAX_AGENT_LOOPS; loop++) {
    const client = getClient();

    const response = await client.post('/chat/completions', {
      model: config.llm.model,
      max_tokens: 1024,
      temperature: 0.7,
      messages,
      tools: allTools,
      tool_choice: 'auto',
    });

    const choice = response.data?.choices?.[0];
    const assistantMessage = choice?.message;

    if (!assistantMessage) {
      throw new Error('大模型返回空响应');
    }

    // mimo 兼容：如果 content 为空但 reasoning_content 有内容，用 reasoning_content
    if (!assistantMessage.content && assistantMessage.reasoning_content) {
      assistantMessage.content = assistantMessage.reasoning_content;
    }

    // 将助手消息加入对话
    messages.push(assistantMessage);

    // 如果没有工具调用，说明大模型直接回复了
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      // 兜底：从活动日志中提取搜索到的歌曲 ID
      const collectedSongs = [];
      for (const log of activityLog) {
        if (log.tool === 'search_song' && Array.isArray(log.result)) {
          for (const s of log.result) {
            if (s.id) collectedSongs.push(String(s.id));
          }
        }
        if (log.tool === 'pick_from_arsenal' && Array.isArray(log.result)) {
          for (const s of log.result) {
            if (s.id) collectedSongs.push(String(s.id));
          }
        }
      }

      // 去重取前 5 首
      const uniqueSongs = [...new Set(collectedSongs)].slice(0, 5);

      return {
        reply: assistantMessage.content || '...',
        songs: uniqueSongs,
        activityLog,
      };
    }

    // 处理工具调用
    for (const toolCall of assistantMessage.tool_calls) {
      const funcName = toolCall.function.name;
      let funcArgs = {};

      try {
        funcArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch (_) {}

      // 记录活动日志
      activityLog.push({
        tool: funcName,
        args: funcArgs,
        timestamp: Date.now(),
      });

      // 如果是 set_playlist，这是最终结果
      if (funcName === 'set_playlist') {
        return {
          reply: funcArgs.reply || '...',
          songs: (funcArgs.song_ids || []).map(String),
          reason: funcArgs.reason || '',
          activityLog,
        };
      }

      // 执行工具
      let result;
      try {
        result = await executeTool(funcName, funcArgs);
      } catch (err) {
        result = { error: err.message };
      }

      // 记录执行结果
      activityLog[activityLog.length - 1].result = result;

      // 将工具结果加入对话
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  // 循环结束仍未调用 set_playlist，返回默认
  return {
    reply: '我来给你挑几首歌吧',
    songs: [],
    activityLog,
  };
}

// ── 路由处理 ──

async function postChat(req, res, next) {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message 字段必填' });
    }

    if (!config.llm.apiKey) {
      // Mock 模式
      const { pickRandom } = require('../services/playlistService');
      const candidates = await pickRandom(5);
      const songIds = candidates.map(t => String(t.id));
      const tracks = await getPlayableTracks(songIds);

      return res.json({
        reply: `（Mock）你说了"${message}"，我从歌库里挑了 5 首给你。`,
        songs: songIds,
        tracks,
        activityLog: [{ tool: 'mock', args: {}, timestamp: Date.now() }],
      });
    }

    // 运行 Agent
    const result = await runAgent(message, history);

    // 先获取歌曲（必须等待）
    let tracks = [];
    if (result.songs.length > 0) {
      tracks = await getPlayableTracks(result.songs.slice(0, 5)).catch(() => []);
    }

    // 立即返回文字 + 歌曲，TTS 后台生成
    const ttsId = `tts_${Date.now()}`;
    res.json({
      reply: result.reply,
      songs: result.songs,
      tracks,
      djAudio: null,  // 后台生成后通过轮询获取
      ttsId,
      reason: result.reason || '',
      activityLog: result.activityLog,
    });

    // TTS 后台生成（不阻塞响应）
    generateSpeech(result.reply).then(ttsResult => {
      ttsCache.set(ttsId, { url: ttsResult.url, expires: Date.now() + 300000 });
      console.log(`[TTS] 后台生成完成: ${ttsId}`);
    }).catch(err => {
      console.warn('[TTS] 后台生成失败:', err.message);
      ttsCache.set(ttsId, { url: null, expires: Date.now() + 300000 });
    });
  } catch (err) {
    console.error('[Agent] 执行失败:', err.message);
    next(err);
  }
}

/**
 * GET /api/tts/:id — 轮询 TTS 生成状态
 */
async function getTtsStatus(req, res) {
  const { id } = req.params;
  const entry = ttsCache.get(id);

  if (!entry) {
    return res.json({ status: 'pending' });
  }

  if (entry.url === null && entry.expires < Date.now()) {
    ttsCache.delete(id);
    return res.json({ status: 'failed' });
  }

  if (entry.url) {
    return res.json({ status: 'ready', url: entry.url });
  }

  return res.json({ status: 'pending' });
}

module.exports = { postChat, getTtsStatus };
