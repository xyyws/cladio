/**
 * search.js — 搜索 Agent
 *
 * 封装 netease.search()，从编排层接收结构化搜索指令。
 * 不含预搜索短路逻辑（那是 chatController 的快速路径）。
 */

const netease = require('../services/netease');
const { TaskType } = require('./types');

const AGENT_NAME = 'SearchAgent';

const SearchAgent = {
  name: AGENT_NAME,
  capabilities: ['SEARCH'],

  canHandle(taskType) {
    return taskType === TaskType.SEARCH;
  },

  async execute(taskType, params) {
    const { keywords, limit = 5, type = 1 } = params;

    if (!keywords) {
      throw new Error('SearchAgent: keywords is required');
    }

    console.log(`[SearchAgent] 搜索: "${keywords}" (limit=${limit})`);
    const results = await netease.search(keywords, { limit, type });

    return results.map(s => ({
      id: String(s.id),
      name: s.name,
      artists: s.artists,
      album: s.album,
      cover: s.cover,
      duration: s.duration,
      pop: s.pop,
    }));
  },
};

module.exports = SearchAgent;
