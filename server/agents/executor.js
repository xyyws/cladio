/**
 * executor.js — 并行任务执行器
 *
 * 接收一个任务列表（DAG），按依赖关系并行执行。
 * 无依赖的任务并行执行，有依赖的任务等待上游完成后执行。
 */

const { TaskStatus, createResult, createError } = require('./types');
const registry = require('./registry');

/**
 * 执行任务 DAG
 *
 * @param {Array} tasks - 任务列表，每个任务有 deps 字段
 * @param {object} sharedContext - 共享上下文（所有任务可读）
 * @returns {Map<taskId, result>} 任务结果映射
 */
async function executeDAG(tasks, sharedContext = {}) {
  const results = new Map();
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const running = new Map(); // taskId → Promise

  // 判断任务的所有依赖是否已完成
  function depsReady(task) {
    return task.deps.every(depId => {
      const depResult = results.get(depId);
      return depResult && depResult.success;
    });
  }

  // 获取依赖结果的快捷方法
  function getDepResults(task) {
    const depData = {};
    for (const depId of task.deps) {
      const r = results.get(depId);
      if (r && r.success) {
        depData[depId] = r.data;
      }
    }
    return depData;
  }

  // 执行单个任务
  async function runTask(task) {
    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();

    try {
      const agent = registry.findAgent(task.type);
      if (!agent) {
        throw new Error(`No agent registered for task type: ${task.type}`);
      }

      task.agent = agent.name;

      // 将依赖结果注入任务参数
      const enrichedParams = {
        ...task.params,
        _deps: getDepResults(task),
        _shared: sharedContext,
      };

      const data = await agent.execute(task.type, enrichedParams);
      const result = createResult(task.id, data, agent.name);

      task.status = TaskStatus.COMPLETED;
      task.result = data;
      task.finishedAt = Date.now();
      results.set(task.id, result);

      console.log(`[Executor] 任务完成: ${task.type} (${task.agent}) ${(task.finishedAt - task.startedAt)}ms`);
    } catch (err) {
      const result = createError(task.id, err, task.agent);
      task.status = TaskStatus.FAILED;
      task.error = err.message;
      task.finishedAt = Date.now();
      results.set(task.id, result);

      console.error(`[Executor] 任务失败: ${task.type} — ${err.message}`);
    }
  }

  // 主循环：持续检查并执行就绪的任务
  let remaining = tasks.filter(t => t.status === TaskStatus.PENDING);

  while (remaining.length > 0) {
    // 找出所有依赖就绪的任务
    const ready = remaining.filter(t => depsReady(t));

    if (ready.length === 0) {
      // 没有就绪的任务但还有剩余 → 依赖环或全部失败
      console.warn('[Executor] 无就绪任务，剩余任务跳过');
      for (const t of remaining) {
        t.status = TaskStatus.SKIPPED;
        results.set(t.id, createError(t.id, 'Dependency not met or cycle detected'));
      }
      break;
    }

    // 并行执行所有就绪的任务
    const promises = ready.map(t => runTask(t));
    await Promise.allSettled(promises);

    // 更新剩余列表
    remaining = tasks.filter(t =>
      t.status === TaskStatus.PENDING
    );
  }

  return results;
}

/**
 * 简单并行执行（无依赖）
 * @param {Array} tasks - 无依赖的任务列表
 * @param {object} sharedContext
 * @returns {Map}
 */
async function executeParallel(tasks, sharedContext = {}) {
  // 设置无依赖
  tasks.forEach(t => { t.deps = []; });
  return executeDAG(tasks, sharedContext);
}

module.exports = { executeDAG, executeParallel };
