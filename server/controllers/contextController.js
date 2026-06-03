const { senseEnvironment } = require('../services/environment');

/**
 * GET /api/context
 * 返回当前 6 维上下文的原始数据
 */
async function getContext(_req, res, next) {
  try {
    const env = await senseEnvironment();
    res.json({
      timestamp: Date.now(),
      weather: env.weather,
      schedule: [
        { time: '09:00', title: '团队周会', location: 'Zoom' },
        { time: '14:00', title: '代码评审', location: '会议室B' },
      ],
      history: [
        { songId: '347230', title: '晴天', artist: '周杰伦', playedAt: Date.now() - 3600000 },
      ],
      currentTime: env.calendar.timeStr,
      dayPhase: env.calendar.dayPhase,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getContext };
