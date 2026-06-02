/**
 * GET /api/context
 * 返回当前 6 维上下文的原始数据
 */
async function getContext(_req, res, next) {
  try {
    // TODO: 从各外部 API 拉取真实数据
    res.json({
      timestamp: Date.now(),
      weather: { city: 'Shanghai', temp: 22, condition: 'cloudy', humidity: 65 },
      schedule: [
        { time: '09:00', title: '团队周会', location: 'Zoom' },
        { time: '14:00', title: '代码评审', location: '会议室B' },
      ],
      history: [
        { songId: '347230', title: '晴天', artist: '周杰伦', playedAt: Date.now() - 3600000 },
      ],
      currentTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      dayPhase: 'afternoon', // morning | afternoon | evening | night
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getContext };
