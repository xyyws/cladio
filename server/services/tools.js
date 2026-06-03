/**
 * Tools.js — Agent 工具定义与执行器
 *
 * 所有工具遵循 OpenAI Function Calling 规范：
 *   - type: "function"
 *   - function: { name, description, parameters }
 *
 * 每个工具的 execute() 函数负责实际执行逻辑。
 */
const netease = require('./netease');
const { getWeather } = require('./environment');
const { getRecentPlays, getTodayPlayedIds } = require('./stateDB');
const { loadArsenal, searchArsenal, pickRandom } = require('./playlistService');

// ══════════════════════════════════════════════
// 工具定义（注册给大模型）
// ══════════════════════════════════════════════

const TOOL_DEFINITIONS = [
  // ── 基础工具 ──

  {
    type: 'function',
    function: {
      name: 'search_song',
      description: '搜索歌曲。当用户想听特定歌曲、歌手、或风格时使用。',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'string',
            description: '搜索关键词，如歌名、歌手名、风格',
          },
          limit: {
            type: 'number',
            description: '返回结果数量，默认 5',
          },
        },
        required: ['keywords'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '获取当前天气状况。用于根据天气推荐合适的音乐。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_play_history',
      description: '获取用户最近的播放记录。用于避免重复推荐。',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: '返回记录数量，默认 10',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pick_from_arsenal',
      description: '从用户的私人歌库（红心歌单）中随机挑选歌曲。当用户没有指定具体歌曲，需要推荐时使用。',
      parameters: {
        type: 'object',
        properties: {
          count: {
            type: 'number',
            description: '挑选数量，默认 5',
          },
          keywords: {
            type: 'string',
            description: '可选的筛选关键词，如"治愈"、"轻快"',
          },
        },
      },
    },
  },

  // ── 高阶工具 ──

  {
    type: 'function',
    function: {
      name: 'get_song_lyrics',
      description: '获取歌曲的纯文本歌词。当听众询问"这首歌在唱什么"、"歌词是什么意思"、或想了解歌曲表达的情感时调用。可用于在串场词中引用经典歌词片段。',
      parameters: {
        type: 'object',
        properties: {
          song_id: {
            type: 'string',
            description: '歌曲 ID',
          },
        },
        required: ['song_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_song_comments',
      description: '获取歌曲的热门评论（网易云"emo 故事"）。当听众询问这首歌背后的故事、网友评论、或需要情感共鸣素材时调用。每首歌的热评都是听众真实的情感投射，是绝佳的串场词素材。',
      parameters: {
        type: 'object',
        properties: {
          song_id: {
            type: 'string',
            description: '歌曲 ID',
          },
          limit: {
            type: 'number',
            description: '返回评论数量，默认 5，最大 20',
          },
        },
        required: ['song_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'like_song',
      description: '红心（喜欢）或取消红心一首歌。当用户说"我喜欢这首歌"、"收藏"、"红心"时调用。此操作需要用户登录状态。',
      parameters: {
        type: 'object',
        properties: {
          song_id: {
            type: 'string',
            description: '歌曲 ID',
          },
          like: {
            type: 'boolean',
            description: 'true 为红心，false 为取消红心，默认 true',
          },
        },
        required: ['song_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_to_playlist',
      description: '将歌曲收藏到指定歌单，或从歌单中移除。当用户说"把这首歌加到我的XX歌单"、"收藏到歌单"时调用。此操作需要用户登录状态。',
      parameters: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['add', 'del'],
            description: '操作类型：add 添加，del 删除',
          },
          pid: {
            type: 'string',
            description: '歌单 ID',
          },
          tracks: {
            type: 'string',
            description: '歌曲 ID',
          },
        },
        required: ['op', 'pid', 'tracks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_song_details',
      description: '获取歌曲的完整详细信息（歌名、所有歌手、所属专辑、发行时间、封面）。当需要深入了解一首歌的元数据时调用，比如串场词中介绍专辑背景。',
      parameters: {
        type: 'object',
        properties: {
          song_id: {
            type: 'string',
            description: '歌曲 ID',
          },
        },
        required: ['song_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_artist_wiki',
      description: '获取歌手的简要百科信息和演艺经历。当听众询问"这个歌手是谁"、"TA 有什么故事"、或需要在串场词中科普歌手冷知识时调用。',
      parameters: {
        type: 'object',
        properties: {
          artist_id: {
            type: 'string',
            description: '歌手 ID',
          },
        },
        required: ['artist_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'login_netease',
      description: '登录网易云音乐账号。当用户说"登录"、"绑定账号"、"用我的账号播放"时调用。登录后可获取每日推荐、私人歌单等个性化内容。',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: '手机号',
          },
          password: {
            type: 'string',
            description: '密码（与验证码二选一）',
          },
          captcha: {
            type: 'string',
            description: '短信验证码（与密码二选一）',
          },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_daily_recommend_playlists',
      description: '获取每日推荐歌单。当用户说"今天有什么推荐"、"给我推荐歌单"、或每天第一次打开电台时调用，为听众做整体推荐。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_daily_recommend_songs',
      description: '获取每日推荐歌曲。当用户说"今日歌单"、"推荐几首歌"、或需要打造"今日专属歌单"时调用。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_similar_playlists',
      description: '获取包含指定歌曲的相似歌单。当听众说"我还想听类似这种风格的"、"有没有类似的歌单"时调用，用于扩展音乐池。',
      parameters: {
        type: 'object',
        properties: {
          song_id: {
            type: 'string',
            description: '歌曲 ID',
          },
        },
        required: ['song_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_similar_songs',
      description: '获取与指定歌曲相似的歌曲。当用户说"再来首类似的"、"自动接歌"时调用，是实现"无限电台流"的关键工具。',
      parameters: {
        type: 'object',
        properties: {
          song_id: {
            type: 'string',
            description: '歌曲 ID',
          },
        },
        required: ['song_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'load_playlist',
      description: '加载指定歌单并播放。当用户输入歌单ID或链接时调用，如"播放歌单123456"、"加载这个歌单"。',
      parameters: {
        type: 'object',
        properties: {
          playlist_id: {
            type: 'string',
            description: '歌单 ID',
          },
        },
        required: ['playlist_id'],
      },
    },
  },
];

// ══════════════════════════════════════════════
// 工具执行器
// ══════════════════════════════════════════════

async function executeTool(name, args) {
  console.log(`[Agent] 执行工具: ${name}(${JSON.stringify(args)})`);

  switch (name) {
    // ── 基础工具 ──

    case 'search_song': {
      const results = await netease.search(args.keywords, {
        limit: args.limit || 5,
      });
      return results.map(s => ({
        id: s.id,
        name: s.name,
        artists: s.artists,
        album: s.album,
        cover: s.cover,
      }));
    }

    case 'get_weather': {
      return await getWeather();
    }

    case 'get_play_history': {
      return getRecentPlays(args.limit || 10);
    }

    case 'pick_from_arsenal': {
      const todayPlayed = getTodayPlayedIds();
      if (args.keywords) {
        const matches = await searchArsenal(args.keywords, args.count || 5);
        if (matches.length > 0) return matches;
      }
      return await pickRandom(args.count || 5, todayPlayed);
    }

    // ── 高阶工具 ──

    case 'get_song_lyrics': {
      return await netease.getLyrics(args.song_id);
    }

    case 'get_song_comments': {
      const limit = Math.min(args.limit || 5, 20);
      return await netease.getHotComments(args.song_id, limit);
    }

    case 'like_song': {
      return await netease.like(args.song_id, args.like !== false);
    }

    case 'add_to_playlist': {
      return await netease.playlistTracks(args.op, args.pid, args.tracks);
    }

    case 'get_song_details': {
      return await netease.getSongDetail(args.song_id);
    }

    case 'get_artist_wiki': {
      return await netease.getArtistDesc(args.artist_id);
    }

    case 'login_netease': {
      return await netease.login(args.phone, args.password, args.captcha);
    }

    case 'get_daily_recommend_playlists': {
      return await netease.getDailyRecommendPlaylists();
    }

    case 'get_daily_recommend_songs': {
      return await netease.getDailyRecommendSongs();
    }

    case 'get_similar_playlists': {
      return await netease.getSimilarPlaylists(args.song_id);
    }

    case 'get_similar_songs': {
      return await netease.getSimilarSongs(args.song_id);
    }

    case 'load_playlist': {
      const playlist = await netease.getPlaylistDetail(args.playlist_id);
      if (!playlist) return { error: '歌单不存在' };
      const tracks = await netease.api('/playlist/track/all', { id: args.playlist_id, limit: 50 });
      return {
        id: playlist.id,
        name: playlist.name,
        trackCount: playlist.trackCount,
        tracks: (tracks?.songs || []).slice(0, 20).map(s => ({
          id: s.id,
          name: s.name,
          artists: (s.ar || []).map(a => a.name).join(' / '),
        })),
      };
    }

    default:
      return { error: `未知工具: ${name}` };
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
