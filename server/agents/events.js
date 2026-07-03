/**
 * events.js — SSE 事件类型定义 + 工具函数
 *
 * 事件流格式：
 *   event: <type>\n
 *   data: <json>\n\n
 */

// ── 事件类型 ──

const EventType = {
  // 路由阶段
  ROUTING: 'routing',           // 路由分类结果

  // Agent 执行阶段
  AGENT_START: 'agent_start',   // Agent 开始执行任务
  AGENT_DONE: 'agent_done',     // Agent 完成任务
  AGENT_ERROR: 'agent_error',   // Agent 任务失败

  // LLM 阶段
  THINKING: 'thinking',         // LLM 思考中

  // 结果阶段
  REPLY_CHUNK: 'reply_chunk',   // 回复文字流式片段
  REPLY: 'reply',               // 完整回复
  TRACKS: 'tracks',             // 歌曲列表
  TTS_READY: 'tts_ready',       // TTS 完成

  // 控制
  DONE: 'done',                 // 流结束
  ERROR: 'error',               // 错误
};

/**
 * 创建 SSE 格式的事件字符串
 * @param {string} type - 事件类型
 * @param {object} data - 事件数据
 * @returns {string} SSE 格式字符串
 */
function formatSSE(type, data = {}) {
  const payload = {
    ...data,
    timestamp: Date.now(),
  };
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * 创建 SSE 写入器
 * @param {object} res - Express response 对象
 * @returns {object} SSE writer
 */
function createSSEWriter(res) {
  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // Nginx 禁用缓冲
  });

  let closed = false;

  // 客户端断开时标记
  res.on('close', () => {
    closed = true;
  });

  return {
    /** 发送事件 */
    send(type, data = {}) {
      if (closed) return;
      res.write(formatSSE(type, data));
    },

    /** 发送路由事件 */
    routing(route, params) {
      this.send(EventType.ROUTING, { route, params });
    },

    /** 发送 Agent 开始事件 */
    agentStart(agent, task, params = {}) {
      this.send(EventType.AGENT_START, { agent, task, params });
    },

    /** 发送 Agent 完成事件 */
    agentDone(agent, task, result, duration) {
      this.send(EventType.AGENT_DONE, { agent, task, duration });
    },

    /** 发送 Agent 错误事件 */
    agentError(agent, task, error) {
      this.send(EventType.AGENT_ERROR, { agent, task, error });
    },

    /** 发送思考事件 */
    thinking(message = '正在思考...') {
      this.send(EventType.THINKING, { message });
    },

    /** 发送回复片段 */
    replyChunk(text) {
      this.send(EventType.REPLY_CHUNK, { text });
    },

    /** 发送完整回复 */
    reply(text) {
      this.send(EventType.REPLY, { text });
    },

    /** 发送歌曲列表 */
    tracks(songs, trackData = []) {
      this.send(EventType.TRACKS, { songs, tracks: trackData });
    },

    /** 发送 TTS 完成 */
    ttsReady(url) {
      this.send(EventType.TTS_READY, { url });
    },

    /** 发送完成事件 */
    done(extra = {}) {
      this.send(EventType.DONE, extra);
      // 不立即关闭连接，让客户端处理完最后的事件
      setTimeout(() => {
        if (!closed) res.end();
      }, 100);
    },

    /** 发送错误事件 */
    error(message) {
      this.send(EventType.ERROR, { message });
    },

    /** 是否已关闭 */
    get isClosed() {
      return closed;
    },
  };
}

module.exports = { EventType, formatSSE, createSSEWriter };
