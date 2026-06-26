/**
 * Memory Controller — 聊天记忆系统 API
 *
 * GET  /api/memory/chat       — 获取聊天历史
 * POST /api/memory/chat       — 保存聊天消息
 * DEL  /api/memory/chat       — 清空聊天历史
 * GET  /api/memory/prefs      — 获取用户记忆/偏好
 * POST /api/memory/prefs      — 保存用户记忆
 * DEL  /api/memory/prefs/:id  — 删除用户记忆
 * GET  /api/memory/context    — 获取记忆上下文（注入 Agent）
 */
const {
  saveChatMessage,
  getChatHistory,
  clearChatHistory,
  saveMemory,
  getMemories,
  deleteMemory,
  getMemoryContext,
} = require('../services/stateDB');

// ── 聊天消息 ──

function getChat(req, res) {
  const limit = parseInt(req.query.limit) || 50;
  const history = getChatHistory(limit);
  res.json({ status: 200, data: history });
}

function postChat(req, res) {
  const { role, content, tracks } = req.body;
  if (!role || !content) {
    return res.status(400).json({ error: 'role 和 content 必填' });
  }
  saveChatMessage(role, content, tracks);
  res.json({ status: 200 });
}

function deleteChat(_req, res) {
  clearChatHistory();
  res.json({ status: 200, message: '聊天记录已清空' });
}

// ── 用户记忆/偏好 ──

function getPrefs(req, res) {
  const category = req.query.category || null;
  const memories = getMemories(category);
  res.json({ status: 200, data: memories });
}

function postPrefs(req, res) {
  const { category, key, value, confidence, source } = req.body;
  if (!category || !key || !value) {
    return res.status(400).json({ error: 'category、key、value 必填' });
  }
  saveMemory(category, key, value, confidence || 0.5, source || 'explicit');
  res.json({ status: 200 });
}

function deletePrefs(req, res) {
  const { id } = req.params;
  deleteMemory(parseInt(id));
  res.json({ status: 200 });
}

// ── 记忆上下文（注入 Agent prompt） ──

function getContext(_req, res) {
  const context = getMemoryContext();
  res.json({ status: 200, data: context });
}

module.exports = {
  getChat,
  postChat,
  deleteChat,
  getPrefs,
  postPrefs,
  deletePrefs,
  getContext,
};
