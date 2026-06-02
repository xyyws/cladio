/**
 * Environment.js — 外部感知插件
 *
 * getWeather()  — 调用 OpenWeather API 获取实时天气
 * getCalendar() — 获取当前用户状态（飞书/通用日历）
 */
const config = require('../config');

// ══════════════════════════════════════════════
// 天气感知
// ══════════════════════════════════════════════

const WEATHER_MOOD_MAP = {
  Clear: { condition: '晴', mood: '明朗', keywords: ['阳光', '轻快', '元气'] },
  Clouds: { condition: '多云', mood: '慵懒', keywords: ['氛围', '民谣'] },
  Rain: { condition: '雨天', mood: '治愈', keywords: ['温暖', '安静', '治愈'] },
  Drizzle: { condition: '小雨', mood: '文艺', keywords: ['钢琴', '轻音乐'] },
  Thunderstorm: { condition: '雷雨', mood: '戏剧', keywords: ['史诗', '氛围'] },
  Snow: { condition: '雪天', mood: '宁静', keywords: ['纯音乐', '冬天'] },
  Mist: { condition: '雾', mood: '朦胧', keywords: ['梦幻', '电子'] },
  Fog: { condition: '雾', mood: '朦胧', keywords: ['梦幻', '电子'] },
};

/**
 * 调用 OpenWeather API 获取当前天气
 * @returns {Promise<{ city, condition, description, temp, feelsLike, humidity, mood, keywords }>}
 */
async function getWeather() {
  const apiKey = config.openweather.apiKey;
  const city = config.openweather.city || 'Shanghai';

  if (!apiKey) {
    console.warn('[Env] OPENWEATHER_API_KEY 未配置，使用 Mock 天气');
    return getMockWeather();
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=zh_cn`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) throw new Error(`OpenWeather 返回 ${res.status}`);

    const data = await res.json();
    const mainCondition = data.weather?.[0]?.main || 'Clear';
    const moodInfo = WEATHER_MOOD_MAP[mainCondition] || WEATHER_MOOD_MAP.Clear;

    return {
      city: data.name || city,
      condition: moodInfo.condition,
      description: data.weather?.[0]?.description || '',
      temp: Math.round(data.main?.temp || 20),
      feelsLike: Math.round(data.main?.feels_like || 20),
      humidity: data.main?.humidity || 50,
      mood: moodInfo.mood,
      keywords: moodInfo.keywords,
    };
  } catch (err) {
    console.error('[Env] 天气获取失败:', err.message);
    return getMockWeather();
  }
}

function getMockWeather() {
  return {
    city: 'Shanghai',
    condition: '雨天',
    description: '小雨转阴',
    temp: 16,
    feelsLike: 14,
    humidity: 82,
    mood: '治愈',
    keywords: ['温暖', '安静', '治愈'],
  };
}

// ══════════════════════════════════════════════
// 日历/用户状态感知
// ══════════════════════════════════════════════

const DAY_PHASE_MAP = {
  morning: { label: '清晨', status: '刚醒来', energy: '低' },
  afternoon: { label: '午后', status: '工作中', energy: '中' },
  evening: { label: '傍晚', status: '下班放松', energy: '中低' },
  night: { label: '深夜', status: '准备休息', energy: '低' },
};

/**
 * 获取当前用户状态
 * 优先尝试飞书 API，降级到基于时间的推断
 * @returns {Promise<{ dayPhase, timeStr, label, status, energy, calendarEvents }>}
 */
async function getCalendar() {
  const feishuAppId = config.feishu?.appId;

  // 尝试飞书日历
  if (feishuAppId) {
    try {
      const events = await fetchFeishuCalendar();
      if (events.length > 0) {
        return {
          ...getTimeContext(),
          calendarEvents: events,
          status: determineStatusFromEvents(events),
        };
      }
    } catch (err) {
      console.warn('[Env] 飞书日历获取失败:', err.message);
    }
  }

  // 降级：基于时间推断
  return {
    ...getTimeContext(),
    calendarEvents: [],
    status: DAY_PHASE_MAP[getTimeContext().dayPhase].status,
  };
}

function getTimeContext() {
  const now = new Date();
  const hour = now.getHours();
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  let dayPhase;
  if (hour >= 6 && hour < 12) dayPhase = 'morning';
  else if (hour >= 12 && hour < 18) dayPhase = 'afternoon';
  else if (hour >= 18 && hour < 23) dayPhase = 'evening';
  else dayPhase = 'night';

  return {
    hour,
    timeStr,
    dayPhase,
    ...DAY_PHASE_MAP[dayPhase],
  };
}

/**
 * 飞书日历 API 骨架（待实现）
 */
async function fetchFeishuCalendar() {
  // TODO: 实现飞书日历 API 调用
  // 1. 获取 tenant_access_token
  // 2. 调用 /calendar/v4/calendars/{calendar_id}/events
  // 3. 返回今日事件列表
  return [];
}

function determineStatusFromEvents(events) {
  const now = Date.now();
  const currentEvent = events.find(e => {
    const start = new Date(e.startTime).getTime();
    const end = new Date(e.endTime).getTime();
    return now >= start && now <= end;
  });

  if (currentEvent) return `正在: ${currentEvent.title}`;
  return DAY_PHASE_MAP[getTimeContext().dayPhase].status;
}

// ══════════════════════════════════════════════
// 组合感知
// ══════════════════════════════════════════════

/**
 * 一次性获取所有环境数据（并行）
 */
async function senseEnvironment() {
  const [weather, calendar] = await Promise.allSettled([
    getWeather(),
    getCalendar(),
  ]);

  return {
    weather: weather.status === 'fulfilled' ? weather.value : getMockWeather(),
    calendar: calendar.status === 'fulfilled' ? calendar.value : { ...getTimeContext(), calendarEvents: [], status: '未知' },
  };
}

module.exports = { getWeather, getCalendar, getTimeContext, senseEnvironment };
