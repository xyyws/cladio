/**
 * registry.js — Agent 注册表
 *
 * 管理所有 Agent 的注册和查找。
 * 每个 Agent 必须实现: { name, canHandle(taskType), execute(task) }
 */

const agents = new Map();

/**
 * 注册一个 Agent
 * @param {object} agent - { name, canHandle, execute }
 */
function register(agent) {
  if (!agent.name || typeof agent.execute !== 'function') {
    throw new Error(`Invalid agent: must have name and execute()`);
  }
  agents.set(agent.name, agent);
  console.log(`[Registry] 注册 Agent: ${agent.name}`);
}

/**
 * 根据任务类型查找能处理的 Agent
 * @param {string} taskType - TaskType
 * @returns {object|null}
 */
function findAgent(taskType) {
  for (const agent of agents.values()) {
    if (agent.canHandle(taskType)) {
      return agent;
    }
  }
  return null;
}

/**
 * 获取所有已注册的 Agent
 */
function getAll() {
  return [...agents.values()];
}

/**
 * 获取 Agent 信息摘要
 */
function getSummary() {
  return [...agents.values()].map(a => ({
    name: a.name,
    capabilities: a.capabilities || [],
  }));
}

module.exports = { register, findAgent, getAll, getSummary };
