import { eq, or, and, asc, desc, inArray, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { games, guesses, users, bot_drawings } from '../db/schema.js';
import { POINTS_BY_DIFFICULTY, SECONDS_BY_DIFFICULTY, normaliseGuess } from '../utils/word-list.js';

export { games, guesses };

/** Statuses that mean the round is still being played. */
const ACTIVE_STATUSES = ['waiting', 'drawing'];

/**
 * Whether a round has finished, however it finished.
 * Once it has, the prompt word is safe to show to everyone.
 *
 * @param {Object} game - A game row.
 * @returns {boolean} True for 'won', 'timeout' and 'abandoned'.
 */
export const isGameOver = (game) => !ACTIVE_STATUSES.includes(game.status);

/**
 * How many seconds are left in a round.
 *
 * The countdown is worked out from `started_at` on the server, so a player
 * cannot buy themselves extra time by changing their computer's clock.
 *
 * @param {Object} game - A game row.
 * @returns {number} Whole seconds remaining, never below zero.
 */
export const secondsLeftInGame = (game) => {
  const total = SECONDS_BY_DIFFICULTY[game.difficulty] || SECONDS_BY_DIFFICULTY.easy;

  if (!game.started_at) return total;

  const elapsed = (Date.now() - new Date(game.started_at).getTime()) / 1000;

  return Math.max(0, Math.round(total - elapsed));
};

/** How much of a practice round the bot spends drawing before the picture is finished. */
const AI_REVEAL_FRACTION = 0.7;

/**
 * The part of a practice drawing that should be on screen by now.
 *
 * The bot plans the whole picture up front, but the guesser is only ever sent
 * the strokes that have "been drawn" so far — so the answer cannot be read out
 * of the network tab. Once the round is over the full drawing is safe to send.
 *
 * @param {Object} game - A game row.
 * @returns {Array<Object>} The strokes to paint, oldest first.
 */
export const visibleAiStrokes = (game) => {
  if (!game.ai_strokes) return [];

  let strokes;

  try {
    strokes = JSON.parse(game.ai_strokes);
  } catch {
    return [];
  }

  if (isGameOver(game)) return strokes;

  const total = SECONDS_BY_DIFFICULTY[game.difficulty] || SECONDS_BY_DIFFICULTY.easy;
  const elapsed = total - secondsLeftInGame(game);
  const drawn = Math.min(1, elapsed / (total * AI_REVEAL_FRACTION));

  return strokes.slice(0, Math.ceil(strokes.length * drawn));
};

/**
 * Pick one of Kibry Bot's pictures at random for a difficulty.
 *
 * The pictures were drawn ahead of time, so this is a plain database read —
 * nothing is generated while the player waits. Returns undefined when the bot
 * has not been taught to draw anything at this difficulty yet.
 *
 * @param {string} difficulty - 'easy', 'medium', or 'hard'.
 * @returns {Promise<Object|undefined>} A row with `word` and `strokes` (JSON text).
 */
export const findRandomBotDrawing = async (difficulty) => {
  const rows = await db
    .select()
    .from(bot_drawings)
    .where(eq(bot_drawings.difficulty, difficulty))
    .orderBy(sql`random()`)
    .limit(1);

  return rows[0];
};

/** Get all games, newest first. Supports optional `status`, `mode`, `difficulty` and `user_id` filters. */
export const findAllGames = async (filters = {}) => {
  const conditions = [];

  if (filters.status) conditions.push(eq(games.status, filters.status));
  if (filters.mode) conditions.push(eq(games.mode, filters.mode));
  if (filters.difficulty) conditions.push(eq(games.difficulty, filters.difficulty));

  // A player counts as being in a game whether they drew or guessed.
  if (filters.user_id) {
    conditions.push(or(eq(games.drawer_id, filters.user_id), eq(games.guesser_id, filters.user_id)));
  }

  if (conditions.length > 0) {
    return await db.select().from(games).where(and(...conditions)).orderBy(desc(games.created_at));
  }

  return await db.select().from(games).orderBy(desc(games.created_at));
};

/** Get a single game by ID. Returns undefined if not found. */
export const findGameById = async (id) => {
  const rows = await db.select().from(games).where(eq(games.game_id, id));
  return rows[0];
};

/** Get a single game by its room code. Returns undefined if not found. */
export const findGameByRoomCode = async (room_code) => {
  const rows = await db.select().from(games).where(eq(games.room_code, room_code));
  return rows[0];
};

/** Create a new room. */
export const insertGame = async (data) => {
  const rows = await db.insert(games).values(data).returning();
  return rows[0];
};

/** Delete a game by ID. Its guesses go with it. Returns undefined if not found. */
export const removeGame = async (id) => {
  const rows = await db.delete(games).where(eq(games.game_id, id)).returning();
  return rows[0];
};

/** Get every guess in a game, oldest first. */
export const findGuessesByGameId = async (game_id) => {
  return await db.select().from(guesses).where(eq(guesses.game_id, game_id)).orderBy(asc(guesses.created_at));
};

/**
 * Put a second player into a waiting room and start the clock.
 *
 * Runs in a transaction so two people racing for the last seat cannot both get
 * in. Returns `null` when the room does not exist, `{ notWaiting: true }` when
 * somebody already joined or the round is over, `{ sameUser: true }` when the
 * drawer tries to join their own room, otherwise the updated game row.
 */
export const joinGame = async (game_id, guesser_id) => {
  return await db.transaction(async (tx) => {
    const rows = await tx.select().from(games).where(eq(games.game_id, game_id));
    const game = rows[0];

    if (!game) return null;
    if (game.drawer_id === guesser_id) return { sameUser: true };
    if (game.status !== 'waiting') return { notWaiting: true };

    const updated = await tx
      .update(games)
      .set({ guesser_id, status: 'drawing', started_at: new Date().toISOString() })
      .where(eq(games.game_id, game_id))
      .returning();

    return updated[0];
  });
};

/**
 * Save the drawer's latest picture and bump the version counter.
 *
 * The version is what the guesser's browser watches — it only downloads the
 * picture again once the number has changed. Returns `null` when the game does
 * not exist and `{ notActive: true }` once the round is over.
 */
export const saveGameCanvas = async (game_id, canvas_data) => {
  return await db.transaction(async (tx) => {
    const rows = await tx.select().from(games).where(eq(games.game_id, game_id));
    const game = rows[0];

    if (!game) return null;
    if (game.status !== 'drawing') return { notActive: true };

    const updated = await tx
      .update(games)
      .set({ canvas_data, canvas_version: sql`${games.canvas_version} + 1` })
      .where(eq(games.game_id, game_id))
      .returning();

    return updated[0];
  });
};

/**
 * Finish a round that nobody won, without touching anyone's points.
 *
 * @param {string} game_id - The game to close.
 * @param {string} status - 'timeout' when the clock ran out, 'abandoned' when a player quit.
 */
export const endGame = async (game_id, status) => {
  return await db.transaction(async (tx) => {
    const rows = await tx.select().from(games).where(eq(games.game_id, game_id));
    const game = rows[0];

    if (!game) return null;
    if (!ACTIVE_STATUSES.includes(game.status)) return { alreadyEnded: true };

    const updated = await tx
      .update(games)
      .set({ status, ended_at: new Date().toISOString() })
      .where(eq(games.game_id, game_id))
      .returning();

    return updated[0];
  });
};

/**
 * Record a guess, and end the round with points for both players if it is right.
 *
 * Everything happens in one transaction, so a round can only ever be won once
 * and the points can only ever be paid out once.
 *
 * Returns `null` when the game does not exist, `{ notActive: true }` when the
 * round is not running, `{ notGuesser: true }` when somebody other than the
 * guesser tries it, `{ expired: true }` when the clock has already run out,
 * otherwise a summary of the guess.
 */
export const insertGuess = async (game_id, user_id, guess_text) => {
  return await db.transaction(async (tx) => {
    const rows = await tx.select().from(games).where(eq(games.game_id, game_id));
    const game = rows[0];

    if (!game) return null;
    if (game.status !== 'drawing') return { notActive: true };
    if (game.guesser_id !== user_id) return { notGuesser: true };

    // The clock is checked here as well as when the state is polled, so a guess
    // that arrives a moment too late still cannot steal the win.
    if (secondsLeftInGame(game) <= 0) {
      await tx
        .update(games)
        .set({ status: 'timeout', ended_at: new Date().toISOString() })
        .where(eq(games.game_id, game_id));

      return { expired: true };
    }

    const cleanedGuess = normaliseGuess(guess_text);
    const isCorrect = cleanedGuess === normaliseGuess(game.prompt_word);

    await tx.insert(guesses).values({
      game_id,
      user_id,
      guess_text: cleanedGuess,
      is_correct: isCorrect,
    });

    if (!isCorrect) {
      return { correct: false, guess_text: cleanedGuess };
    }

    const endedAt = new Date().toISOString();

    await tx
      .update(games)
      .set({ status: 'won', winning_guess: cleanedGuess, ended_at: endedAt })
      .where(eq(games.game_id, game_id));

    // Practice rounds against the bot are just for fun — beating a computer
    // should not move a leaderboard that ranks people against each other.
    if (game.mode === 'ai') {
      return {
        correct: true,
        guess_text: cleanedGuess,
        prompt_word: game.prompt_word,
        difficulty: game.difficulty,
        pointsEarned: 0,
        secondsLeft: secondsLeftInGame(game),
        players: [],
      };
    }

    const pointsEarned = POINTS_BY_DIFFICULTY[game.difficulty] || POINTS_BY_DIFFICULTY.easy;

    // Drawing well and guessing well are both worth the same — the pair only
    // scores when they manage it together.
    await tx
      .update(users)
      .set({
        points: sql`${users.points} + ${pointsEarned}`,
        total_score: sql`${users.total_score} + ${pointsEarned}`,
      })
      .where(inArray(users.user_id, [game.drawer_id, game.guesser_id]));

    const scored = await tx
      .select({ user_id: users.user_id, points: users.points, total_score: users.total_score })
      .from(users)
      .where(inArray(users.user_id, [game.drawer_id, game.guesser_id]));

    return {
      correct: true,
      guess_text: cleanedGuess,
      prompt_word: game.prompt_word,
      difficulty: game.difficulty,
      pointsEarned,
      secondsLeft: secondsLeftInGame(game),
      players: scored,
    };
  });
};
