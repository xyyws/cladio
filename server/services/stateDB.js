/**
 * StateDB.js — 本地 SQLite 记忆库
 *
 * 表结构设计（3NF/BCNF）：
 *
 *   songs (song_id PK, title, artist, album, cover_url)
 *     ↕ FK
 *   play_history (id PK, song_id FK, played_at)
 *     ↕ FK
 *   ai_logs (id PK, play_id FK, say, weather, temperature, day_phase, created_at)
 *
 * 为什么这样设计：
 *   - songs 表独立存储歌曲元数据，避免 play_history 中重复存储歌名/歌手
 *   - play_history 只存 song_id + 时间戳，通过 JOIN 获取歌曲详情
 *   - ai_logs 通过 play_id 关联到具体某次播放，记录当时的环境快照
 *   - 每个表只描述一个实体（歌曲/播放/AI决策），消除部分依赖和传递依赖
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'claudio.db');

// 确保 data 目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db = null;

function getDb() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');    // 写入性能优化
  db.pragma('foreign_keys = ON');     // 启用外键约束

  initTables();
  console.log('[StateDB] 数据库初始化完成:', DB_PATH);
  return db;
}

function initTables() {
  db.exec(`
    -- 歌曲实体表（独立，避免冗余）
    CREATE TABLE IF NOT EXISTS songs (
      song_id   TEXT PRIMARY KEY,
      title     TEXT,
      artist    TEXT,
      album     TEXT,
      cover_url TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 播放流水表（只存 ID + 时间，通过 FK 关联歌曲）
    CREATE TABLE IF NOT EXISTS play_history (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id   TEXT NOT NULL,
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (song_id) REFERENCES songs(song_id) ON DELETE CASCADE
    );

    -- AI 状态日志（记录每次 AI 决策时的环境快照）
    CREATE TABLE IF NOT EXISTS ai_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      play_id     INTEGER,
      say         TEXT,
      weather     TEXT,
      temperature TEXT,
      day_phase   TEXT,
      reason      TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (play_id) REFERENCES play_history(id) ON DELETE SET NULL
    );

    -- 索引：加速"最近播放"查询
    CREATE INDEX IF NOT EXISTS idx_play_history_played_at
      ON play_history(played_at DESC);

    CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at
      ON ai_logs(created_at DESC);
  `);
}

// ══════════════════════════════════════════════
// 歌曲管理
// ══════════════════════════════════════════════

/**
 * 插入或更新歌曲元数据（UPSERT）
 */
function upsertSong(songId, { title, artist, album, coverUrl } = {}) {
  const stmt = getDb().prepare(`
    INSERT INTO songs (song_id, title, artist, album, cover_url, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(song_id) DO UPDATE SET
      title = COALESCE(excluded.title, songs.title),
      artist = COALESCE(excluded.artist, songs.artist),
      album = COALESCE(excluded.album, songs.album),
      cover_url = COALESCE(excluded.cover_url, songs.cover_url),
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(songId, title || null, artist || null, album || null, coverUrl || null);
}

// ══════════════════════════════════════════════
// 播放记录
// ══════════════════════════════════════════════

/**
 * 记录一次播放
 * @param {string} songId
 * @param {object} [songMeta] - 可选的歌曲元数据 { title, artist, album, coverUrl }
 * @returns {number} play_history.id
 */
function logPlay(songId, songMeta) {
  // 确保 songs 表中存在该歌曲（外键约束）
  upsertSong(songId, songMeta || {});

  const stmt = getDb().prepare('INSERT INTO play_history (song_id) VALUES (?)');
  const result = stmt.run(songId);
  return result.lastInsertRowid;
}

/**
 * 获取最近播放的歌曲列表（带歌曲详情）
 * @param {number} limit - 返回数量
 * @returns {Array<{ songId, title, artist, playedAt }>}
 */
function getRecentPlays(limit = 20) {
  const stmt = getDb().prepare(`
    SELECT
      ph.song_id   AS songId,
      s.title      AS title,
      s.artist     AS artist,
      ph.played_at AS playedAt
    FROM play_history ph
    LEFT JOIN songs s ON ph.song_id = s.song_id
    ORDER BY ph.played_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

/**
 * 获取今天播放过的歌曲 ID 列表（用于排他性选歌）
 * @returns {string[]}
 */
function getTodayPlayedIds() {
  const stmt = getDb().prepare(`
    SELECT DISTINCT song_id
    FROM play_history
    WHERE played_at >= date('now', 'start of day')
    ORDER BY played_at DESC
  `);
  return stmt.all().map(r => r.song_id);
}

// ══════════════════════════════════════════════
// AI 日志
// ══════════════════════════════════════════════

/**
 * 记录一次 AI 决策
 */
function logAI({ playId, say, weather, temperature, dayPhase, reason }) {
  const stmt = getDb().prepare(`
    INSERT INTO ai_logs (play_id, say, weather, temperature, day_phase, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(playId || null, say || null, weather || null, temperature || null, dayPhase || null, reason || null);
}

/**
 * 获取最近的 AI 日志
 */
function getRecentAILogs(limit = 10) {
  return getDb().prepare(`
    SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

// ══════════════════════════════════════════════
// 统计
// ══════════════════════════════════════════════

function getPlayCount() {
  return getDb().prepare('SELECT COUNT(*) AS count FROM play_history').get().count;
}

function getUniqueSongCount() {
  return getDb().prepare('SELECT COUNT(DISTINCT song_id) AS count FROM play_history').get().count;
}

module.exports = {
  getDb,
  logPlay,
  getRecentPlays,
  getTodayPlayedIds,
  upsertSong,
  logAI,
  getRecentAILogs,
  getPlayCount,
  getUniqueSongCount,
};
