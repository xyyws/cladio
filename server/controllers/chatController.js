/**
 * POST /api/chat — AI Agent 对话引擎
 *
 * 使用 OpenAI SDK + 大模型原生 Function Calling 能力：
 *   1. 用户消息 + 工具定义 → 发给大模型
 *   2. 大模型决定调用哪些工具
 *   3. 执行工具，将结果返回给大模型
 *   4. 大模型生成最终回复
 *   5. 返回给前端：回复文本 + 工具调用日志 + 推荐歌曲
 *
 * TTS 异步化：
 *   - 聊天立即返回文字 + 歌曲
 *   - TTS 后台生成，前端通过 /api/tts/:id 轮询获取
 *
 * 最多循环 4 轮（防止无限调用）
 */
const OpenAI = require('openai');
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
const { saveChatMessage, getMemoryContext } = require('../services/stateDB');

// Python Agent Service 配置
const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8001';
const USE_AGENT_SERVICE = process.env.USE_AGENT_SERVICE === 'true';

// 多 Agent 编排
const { classify } = require('../agents/router');
const registry = require('../agents/registry');
const RecommendAgent = require('../agents/recommend');
const { createSSEWriter } = require('../agents/events');
const SearchAgent = require('../agents/search');

// 注册 Agents
registry.register(RecommendAgent);
registry.register(SearchAgent);

const MAX_AGENT_LOOPS = 4;

const SYSTEM_PROMPT = `你是 Claudio，一位有品味的 AI 电台主播。

## 你的工具

| 工具 | 何时使用 |
|------|----------|
| search_song | 用户指定歌曲/歌手/风格 |
| pick_from_arsenal | 用户没指定具体歌曲，随机推荐 |
| set_playlist | 决策完成后提交歌曲列表（必须调用） |
| get_song_comments | 用户问评论/热评 |
| get_song_lyrics | 用户问歌词 |
| get_artist_wiki | 用户问歌手信息 |
| load_playlist | 用户提供歌单ID |
| save_memory | 用户表达偏好/习惯 |

## 行为准则（必须严格遵守）

1. **点歌流程**：search_song → 拿到结果 → 立即调用 set_playlist 提交歌曲 ID
2. **推荐流程**：pick_from_arsenal → 拿到结果 → 立即调用 set_playlist
3. **每次回复必须调用 set_playlist**，这是强制要求
4. **不要重复搜索**：search_song 只调用一次
5. **不要做多余操作**：拿到歌曲后直接提交，不要额外解释
6. **预搜索结果**：如果系统提供了预搜索结果，直接使用那些歌曲 ID，不需要再调用 search_song

## 回复风格
- 温暖自然，像朋友聊天
- 1-3 句话，不要太长
- 不要输出 Markdown 格式`;

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

// ── OpenAI 客户端 ──

function getClient() {
  return new OpenAI({
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseUrl,
    timeout: 30000,
    maxRetries: 0,
  });
}

// ── Agent 主循环 ──

async function runAgent(userMessage, history) {
  const allTools = [...TOOL_DEFINITIONS, SET_PLAYLIST_TOOL];
  const activityLog = []; // 记录 Agent 的每一步操作

  // ── 意图识别 + 预搜索 ──
  const isPointSong = /来.{0,2}首|想听|播放|放一首|点一首|来一首|放首|给我来|搜索|搜|的歌/.test(userMessage);
  const isRecommend = /推荐|随便|来点|来几首/.test(userMessage);
  const isInfo = /歌词|评论|热评|歌手|谁唱的|介绍一下/.test(userMessage);

  // 风格推荐检测（"推荐rap"、"来点摇滚"等）
  const genreMatch = userMessage.match(/(?:推荐|来点|来几首|放点|想听|来首)\s*(?:一些|一点|几首)?\s*(rap|嘻哈|说唱|摇滚|民谣|电子|古典|爵士|r&b|流行|古风|国风|轻音乐|纯音乐|hiphop|hip-hop|indie|lofi|lo-fi|华语|粤语|日语|韩语|英语|欧美|民歌|戏曲|蓝调|blues|jazz|country|folk|edm|metal|punk|soul|funk)/i);

  // 提取关键词（去掉意图词）
  const keywords = userMessage
    .replace(/播放|来一首|想听|来首|放一首|放首|给我来|点一首|点首|推荐|搜索|搜|的歌|歌|音乐|的|吧|吗|呢|啊/g, '')
    .trim();

  // 风格关键词（优先用风格匹配结果）
  const genreKeyword = genreMatch?.[1]?.trim();

  let preSearchResults = [];
  const searchKeyword = genreKeyword || keywords;
  if ((isPointSong || genreKeyword) && searchKeyword.length >= 1) {
    try {
      preSearchResults = await netease.search(searchKeyword, { limit: 10 });
      console.log(`[Agent] 预搜索 "${searchKeyword}": ${preSearchResults.length} 首`);
    } catch (err) {
      console.warn('[Agent] 预搜索失败:', err.message);
    }
  }

  // 预搜索成功时，直接返回结果（不经过 LLM）
  if ((isPointSong || genreKeyword) && preSearchResults.length > 0) {
    const songIds = preSearchResults.slice(0, 5).map(s => String(s.id));
    const names = preSearchResults.slice(0, 3).map(s => `${s.name} - ${s.artists}`).join('、');
    activityLog.push({
      tool: 'search_song',
      args: { keywords: searchKeyword },
      result: preSearchResults.slice(0, 3),
      timestamp: Date.now(),
    });
    const reply = genreKeyword
      ? `为你推荐几首${genreKeyword}风格的歌曲：${names}，希望你喜欢~`
      : `找到了 ${names}，马上为你播放~`;
    return {
      reply,
      songs: songIds,
      activityLog,
    };
  }

  // 组装初始消息
  const env = await getEnvironmentSnapshot().catch(() => ({}));
  const contextInfo = [
    `当前时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    `天气: ${env.weather || '未知'}`,
    `时段: ${env.dayPhase || '未知'}`,
  ].join('；');

  // 意图提示
  let intentHint = '';
  if (isPointSong) {
    if (preSearchResults.length > 0) {
      // 有预搜索结果时，强制使用搜索结果，禁止 pick_from_arsenal
      intentHint = '\n\n【用户意图】点歌（已搜索到结果）\n⚠️ 你必须直接调用 set_playlist 提交下方预搜索结果中的歌曲 ID。\n⚠️ 禁止调用 pick_from_arsenal、search_song 或任何其他搜索工具。\n⚠️ 直接从预搜索结果中选 1-3 首，调用 set_playlist。';
    } else {
      intentHint = '\n\n【用户意图】点歌 — 必须先调用 search_song 搜索用户指定的歌曲，然后 set_playlist 提交。禁止使用 pick_from_arsenal。';
    }
  } else if (isRecommend) {
    intentHint = '\n\n【用户意图】推荐 — 请使用 pick_from_arsenal，然后 set_playlist 提交';
  } else if (isInfo) {
    intentHint = '\n\n【用户意图】查询信息 — 使用对应工具获取信息，然后 set_playlist 提交歌曲';
  }

  // 如果有预搜索结果，注入到 prompt 中
  let searchHint = '';
  if (preSearchResults.length > 0) {
    const songList = preSearchResults.map(s =>
      `- ${s.id}: "${s.name}" - ${s.artists}`
    ).join('\n');
    searchHint = `\n\n【预搜索结果】已找到以下歌曲，请直接使用这些 ID 调用 set_playlist：\n${songList}`;
  }

  // 注入用户记忆上下文
  const memoryContext = getMemoryContext();
  const memoryHint = memoryContext ? `\n\n【用户记忆】\n${memoryContext}` : '';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + `\n\n环境信息: ${contextInfo}${intentHint}${searchHint}${memoryHint}` },
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

    const response = await client.chat.completions.create({
      model: config.llm.model,
      max_tokens: 1024,
      temperature: 0.7,
      messages,
      tools: allTools,
      tool_choice: 'auto',
    });

    const assistantMessage = response.choices[0]?.message;

    if (!assistantMessage) {
      throw new Error('大模型返回空响应');
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

// ── Python Agent Service 调用 ──

async function callAgentService(message, history, context) {
  const response = await fetch(`${AGENT_SERVICE_URL}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, context }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`Agent Service 返回 ${response.status}`);
  }

  return await response.json();
}

// ── Orchestrator 调用 ──

async function callOrchestrator(message, history, context, scenario) {
  const response = await fetch(`${AGENT_SERVICE_URL}/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, context, scenario }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`Orchestrator 返回 ${response.status}`);
  }

  const data = await response.json();
  return {
    reply: data.reply || '...',
    songs: data.songs || [],
    activityLog: data.activity_log || [],
    orchestration: {
      scenario: data.scenario,
      time: data.orchestration_time,
    },
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

    // 获取环境上下文
    const env = await getEnvironmentSnapshot().catch(() => ({}));
    const context = {
      weather: env.weather || '未知',
      dayPhase: env.dayPhase || '未知',
      temperature: env.temperature || '未知',
    };

    let result;

    // Router Agent 分类
    const routing = classify(message);
    console.log(`[Chat] 路由分类: ${routing.route} (${JSON.stringify(routing.params)})`);

    if (routing.route === 'search' || routing.route === 'genre') {
      // 快速路径：预搜索短路（0 LLM）
      console.log('[Chat] 快速路径，使用 Node.js Agent');
      result = await runAgent(message, history);
    } else if (routing.route === 'complex') {
      // 编排路径：调用 Python Orchestrator
      console.log(`[Chat] 编排路径 (scenario=${routing.params.scenario})，使用 Orchestrator`);
      result = await callOrchestrator(message, history, context, routing.params.scenario);
    } else if (USE_AGENT_SERVICE) {
      try {
        console.log('[Chat] 使用 Python Agent Service');
        const agentResult = await callAgentService(message, history, context);
        result = {
          reply: agentResult.reply || '...',
          songs: agentResult.songs || [],
          activityLog: agentResult.activity_log || [],
        };
      } catch (err) {
        console.warn('[Chat] Agent Service 调用失败，降级到 Node.js Agent:', err.message);
        result = await runAgent(message, history);
      }
    } else {
      // 使用 Node.js Agent
      result = await runAgent(message, history);
    }

    // 先获取歌曲（必须等待）
    let tracks = [];
    if (result.songs.length > 0) {
      tracks = await getPlayableTracks(result.songs.slice(0, 5)).catch(() => []);
    }

    // Agent 成功后，保存用户消息和 AI 回复到记忆
    saveChatMessage('user', message);
    saveChatMessage('assistant', result.reply, tracks.length > 0 ? tracks : null);

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

// ── SSE 流式端点 ──

/**
 * POST /api/chat/stream — SSE 流式聊天
 *
 * 保持与 postChat 相同的逻辑，但通过 SSE 实时推送 Agent 活动事件。
 */
async function postChatStream(req, res) {
  const sse = createSSEWriter(res);

  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string') {
      sse.error('message 字段必填');
      sse.done();
      return;
    }

    // Mock 模式
    if (!config.llm.apiKey) {
      const { pickRandom } = require('../services/playlistService');
      const candidates = await pickRandom(5);
      const songIds = candidates.map(t => String(t.id));
      const tracks = await getPlayableTracks(songIds);

      sse.reply(`（Mock）你说了"${message}"，我从歌库里挑了 5 首给你。`);
      sse.tracks(songIds, tracks);
      sse.done();
      return;
    }

    // 获取环境上下文
    const env = await getEnvironmentSnapshot().catch(() => ({}));
    const context = {
      weather: env.weather || '未知',
      dayPhase: env.dayPhase || '未知',
      temperature: env.temperature || '未知',
    };

    // ── 路由分类 ──
    const routing = classify(message);
    sse.routing(routing.route, routing.params);

    let result;

    if (routing.route === 'search' || routing.route === 'genre') {
      // 快速路径
      sse.agentStart('SearchAgent', routing.route, routing.params);
      const start = Date.now();
      result = await runAgent(message, history);
      sse.agentDone('SearchAgent', routing.route, null, Date.now() - start);
    } else if (routing.route === 'complex') {
      // 编排路径 — 调用 Orchestrator SSE 端点
      sse.thinking('正在编排多 Agent 任务...');
      result = await streamOrchestrator(message, history, context, routing.params.scenario, sse);
    } else if (USE_AGENT_SERVICE) {
      // Python Agent
      sse.agentStart('ClaudioAgent', 'chat');
      const start = Date.now();
      try {
        const agentResult = await callAgentService(message, history, context);
        result = {
          reply: agentResult.reply || '...',
          songs: agentResult.songs || [],
          activityLog: agentResult.activity_log || [],
        };
        sse.agentDone('ClaudioAgent', 'chat', null, Date.now() - start);
      } catch (err) {
        sse.agentError('ClaudioAgent', 'chat', err.message);
        result = await runAgent(message, history);
      }
    } else {
      sse.agentStart('NodeAgent', 'chat');
      const start = Date.now();
      result = await runAgent(message, history);
      sse.agentDone('NodeAgent', 'chat', null, Date.now() - start);
    }

    // ── 获取可播放曲目 ──
    let tracks = [];
    if (result.songs.length > 0) {
      tracks = await getPlayableTracks(result.songs.slice(0, 5)).catch(() => []);
    }

    // 保存对话
    saveChatMessage('user', message);
    saveChatMessage('assistant', result.reply, tracks.length > 0 ? tracks : null);

    // ── 推送结果 ──
    sse.reply(result.reply);
    sse.tracks(result.songs, tracks);

    // TTS 后台生成（不阻塞流）
    const ttsId = `tts_${Date.now()}`;
    generateSpeech(result.reply).then(ttsResult => {
      ttsCache.set(ttsId, { url: ttsResult.url, expires: Date.now() + 300000 });
      if (!sse.isClosed) {
        sse.ttsReady(ttsResult.url);
      }
    }).catch(err => {
      console.warn('[TTS] 后台生成失败:', err.message);
      ttsCache.set(ttsId, { url: null, expires: Date.now() + 300000 });
    });

    sse.done({ ttsId });
  } catch (err) {
    console.error('[ChatStream] 执行失败:', err.message);
    sse.error(err.message);
    sse.done();
  }
}

/**
 * 调用 Orchestrator SSE 端点并转发事件
 */
async function streamOrchestrator(message, history, context, scenario, sse) {
  try {
    const response = await fetch(`${AGENT_SERVICE_URL}/orchestrate/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, context, scenario }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Orchestrator 返回 ${response.status}`);
    }

    // 读取 SSE 流并转发
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = { reply: '...', songs: [], activity_log: [] };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 解析 SSE 事件
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            // 转发事件给客户端
            sse.send(eventType, parsed);

            // 收集最终结果
            if (eventType === 'reply') {
              finalResult.reply = parsed.text || parsed.reply || '...';
            } else if (eventType === 'tracks') {
              finalResult.songs = parsed.songs || [];
            } else if (eventType === 'agent_done' || eventType === 'agent_start') {
              finalResult.activity_log.push({ tool: parsed.agent, args: parsed });
            }
          } catch (_) {}
        }
      }
    }

    return finalResult;
  } catch (err) {
    console.error('[Orchestrator] 流式调用失败:', err.message);
    sse.error(`Orchestrator 调用失败: ${err.message}`);
    // 降级到普通 Agent
    return await runAgent(message, history);
  }
}

module.exports = { postChat, postChatStream, getTtsStatus };
