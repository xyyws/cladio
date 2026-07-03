/**
 * types.js — 多 Agent 编排的类型定义
 *
 * 任务（Task）是编排的基本单元，描述"做什么"
 * 结果（Result）是任务的执行产物
 */

// ── 任务类型 ──

const TaskType = {
  SEARCH: 'SEARCH',           // 搜索歌曲
  RECOMMEND: 'RECOMMEND',     // 推荐歌曲
  KNOWLEDGE: 'KNOWLEDGE',     // 获取知识（歌词/热评/百科）
  MEMORY_READ: 'MEMORY_READ', // 读取用户画像
  MEMORY_WRITE: 'MEMORY_WRITE', // 保存偏好
  GENERATE_SEGUE: 'GENERATE_SEGUE', // 生成串场词
  SET_PLAYLIST: 'SET_PLAYLIST', // 提交最终歌单
  CONTEXT: 'CONTEXT',         // 获取环境上下文
};

// ── 推荐策略 ──

const RecommendStrategy = {
  ARSENAL: 'arsenal',       // 弹药库（红心歌单）
  ATMOSPHERE: 'atmosphere', // 氛围匹配（天气+时段）
  TRENDING: 'trending',     // 热门推荐
  PROFILE: 'profile',       // 基于用户画像
  FOCUS: 'focus',           // 专注模式（学习/工作）
};

// ── 任务状态 ──

const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

/**
 * 创建一个任务
 */
function createTask(type, params = {}, deps = []) {
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    params,
    deps,           // 依赖的任务 ID 列表
    status: TaskStatus.PENDING,
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    agent: null,    // 执行此任务的 Agent 名称
  };
}

/**
 * 创建一个成功结果
 */
function createResult(taskId, data, agent = null) {
  return {
    taskId,
    success: true,
    data,
    agent,
    timestamp: Date.now(),
  };
}

/**
 * 创建一个失败结果
 */
function createError(taskId, error, agent = null) {
  return {
    taskId,
    success: false,
    error: typeof error === 'string' ? error : error.message,
    agent,
    timestamp: Date.now(),
  };
}

module.exports = {
  TaskType,
  RecommendStrategy,
  TaskStatus,
  createTask,
  createResult,
  createError,
};
