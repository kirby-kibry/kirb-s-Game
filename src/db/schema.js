import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'crypto';

/**
 * Every table below that needs a generated ID declares it here rather than
 * leaving each caller to remember one. `randomUUID` is a cryptographic
 * generator with 122 random bits, so two rows colliding is not a practical
 * concern — and if it ever did happen the PRIMARY KEY would reject the insert
 * rather than quietly hand one id to two rows.
 */
const uuid = () => randomUUID();

/** Users table. Passwords are stored as a salted bcrypt hash, never plaintext. */
export const users = sqliteTable('users', {
  user_id: text('user_id').primaryKey().$defaultFn(uuid),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  total_score: integer('total_score').notNull().default(0),
  points: integer('points').notNull().default(0),
});

/**
 * Games table — one head-to-head round.
 *
 * The drawer creates the room and is the only player who is ever sent
 * `prompt_word`. The guesser joins with `room_code` and has to name it.
 * `canvas_data` holds the drawer's live picture as a data URL, and
 * `canvas_version` counts up on every save so the guesser's browser knows when
 * there is a new picture to fetch.
 *
 * status is one of: 'waiting', 'drawing', 'won', 'timeout', 'abandoned'.
 *
 * mode is 'pvp' for a normal two-player round, or 'ai' for a practice round
 * against Kibry Bot. In a practice round nobody is the drawer, so `drawer_id`
 * is empty and `ai_strokes` holds the drawing the bot planned out instead.
 */
export const games = sqliteTable('games', {
  game_id: text('game_id').primaryKey().$defaultFn(uuid),
  room_code: text('room_code').notNull().unique(),
  mode: text('mode').notNull().default('pvp'),
  drawer_id: text('drawer_id').references(() => users.user_id, { onDelete: 'cascade' }),
  guesser_id: text('guesser_id').references(() => users.user_id, { onDelete: 'cascade' }),
  prompt_word: text('prompt_word').notNull(),
  difficulty: text('difficulty').notNull(),
  status: text('status').notNull().default('waiting'),
  canvas_data: text('canvas_data'),
  canvas_version: integer('canvas_version').notNull().default(0),
  ai_strokes: text('ai_strokes'),
  winning_guess: text('winning_guess'),
  started_at: text('started_at'),
  ended_at: text('ended_at'),
  created_at: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

/**
 * Bot drawings table — the pictures Kibry Bot draws in practice rounds.
 *
 * The pictures are drawn ahead of time by `npm run draw` and written to
 * `src/db/bot-drawings.json`, then loaded in here by `npm run db`. Keeping the
 * master copy in a file rather than only in the database means resetting the
 * database never throws the drawings away — and the game needs no API key to
 * play, because nothing is drawn while somebody is waiting.
 *
 * `strokes` holds the brush strokes as JSON, the same shape the browser paints.
 */
export const bot_drawings = sqliteTable('bot_drawings', {
  bot_drawing_id: text('bot_drawing_id').primaryKey().$defaultFn(uuid),
  word: text('word').notNull(),
  difficulty: text('difficulty').notNull(),
  strokes: text('strokes').notNull(),
  created_at: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

/** Guesses table — every guess sent in a round, so both players see the feed. */
export const guesses = sqliteTable('guesses', {
  guess_id: text('guess_id').primaryKey().$defaultFn(uuid),
  game_id: text('game_id').notNull().references(() => games.game_id, { onDelete: 'cascade' }),
  user_id: text('user_id').notNull().references(() => users.user_id, { onDelete: 'cascade' }),
  guess_text: text('guess_text').notNull(),
  is_correct: integer('is_correct', { mode: 'boolean' }).notNull().default(false),
  created_at: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

/** Cosmetics table — the shop catalog. */
export const cosmetics = sqliteTable('cosmetics', {
  cosmetic_id: text('cosmetic_id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull(),
  price: integer('price').notNull(),
  css_value: text('css_value').notNull(),
});

/** User Cosmetics table — tracks ownership. */
export const user_cosmetics = sqliteTable('user_cosmetics', {
  id: text('id').primaryKey().$defaultFn(uuid),
  user_id: text('user_id').notNull().references(() => users.user_id, { onDelete: 'cascade' }),
  cosmetic_id: text('cosmetic_id').notNull().references(() => cosmetics.cosmetic_id, { onDelete: 'cascade' }),
  purchased_at: text('purchased_at').notNull().$defaultFn(() => new Date().toISOString()),
});
