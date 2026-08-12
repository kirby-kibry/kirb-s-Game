import { validationResult } from 'express-validator';
import {
  findAllGames,
  findGameById,
  findGameByRoomCode,
  findGuessesByGameId,
  insertGame,
  insertGuess,
  joinGame,
  saveGameCanvas,
  endGame,
  removeGame,
  secondsLeftInGame,
  isGameOver,
  visibleAiStrokes,
  findRandomBotDrawing,
} from '../models/gameModel.js';
import { findUserById } from '../models/userModel.js';
import { AppError } from '../utils/_errors.js';
import { pickRandomWord, buildPromptHint, POINTS_BY_DIFFICULTY } from '../utils/word-list.js';
import { randomBytes } from 'crypto';

/** Letters a room code is built from. I, O, 0 and 1 are left out so codes are easy to read aloud. */
const ROOM_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Throw a validation error if express-validator found problems. */
const assertValid = (req) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new AppError('VALIDATION_ERROR', errors.array()[0].msg);
};

/**
 * Make a short room code that no other game is using yet.
 *
 * Four characters from a 32-letter alphabet is only about a million codes, so
 * unlike the UUIDs elsewhere these genuinely can repeat — hence the check
 * against the database below, and the unique constraint on `room_code` behind
 * it as the final word.
 *
 * The letters come from `randomBytes` rather than `Math.random()`, which is not
 * a cryptographic generator: its output can be predicted from earlier values,
 * and a guessable code lets a stranger walk into somebody's room.
 */
const generateRoomCode = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = randomBytes(4);
    let code = '';

    for (let i = 0; i < 4; i += 1) {
      // 32 letters is exactly 2^5, so keeping the low 5 bits picks one with no
      // modulo bias — every letter stays equally likely.
      code += ROOM_CODE_LETTERS[bytes[i] & 31];
    }

    const taken = await findGameByRoomCode(code);
    if (!taken) return code;
  }

  throw new AppError('CONFLICT', 'Could not find a free room code, please try again');
};

/** Work out whether a player is the drawer, the guesser, or just watching. */
const findRoleInGame = (game, user_id) => {
  if (game.drawer_id === user_id) return 'drawer';
  if (game.guesser_id === user_id) return 'guesser';
  return 'spectator';
};

/** Look up a player and return just the bits the other player needs to see. */
const describePlayer = async (user_id) => {
  if (!user_id) return null;

  const user = await findUserById(user_id);
  if (!user) return null;

  return { user_id: user.user_id, username: user.username };
};

/** Close any rooms this player left sitting empty, so the lobby stays tidy. */
const closeAbandonedRooms = async (user_id) => {
  const waiting = await findAllGames({ status: 'waiting', user_id });

  for (const game of waiting) {
    await endGame(game.game_id, 'abandoned');
  }
};

/** Get all games. Supports ?status=, ?difficulty= and ?user_id= filters. */
export const getAllGames = async (req, res, next) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.mode) filters.mode = req.query.mode;
    if (req.query.difficulty) filters.difficulty = req.query.difficulty;
    if (req.query.user_id) filters.user_id = req.query.user_id;

    const games = await findAllGames(filters);

    // The prompt is a secret, so it never goes out on a list anyone can read.
    const safeGames = games.map((game) => ({
      game_id: game.game_id,
      room_code: game.room_code,
      mode: game.mode,
      drawer_id: game.drawer_id,
      guesser_id: game.guesser_id,
      difficulty: game.difficulty,
      status: game.status,
      created_at: game.created_at,
      prompt_word: isGameOver(game) ? game.prompt_word : null,
    }));

    res.status(200).json(safeGames);
  } catch (error) {
    next(error);
  }
};

/** Get a single game by ID, with the prompt hidden while the round is live. */
export const getGameById = async (req, res, next) => {
  try {
    const game = await findGameById(req.params.id);

    if (!game) throw new AppError('NOT_FOUND', 'Game not found');

    res.status(200).json({
      game_id: game.game_id,
      room_code: game.room_code,
      mode: game.mode,
      drawer_id: game.drawer_id,
      guesser_id: game.guesser_id,
      difficulty: game.difficulty,
      status: game.status,
      canvas_version: game.canvas_version,
      winning_guess: game.winning_guess,
      started_at: game.started_at,
      ended_at: game.ended_at,
      created_at: game.created_at,
      prompt_word: isGameOver(game) ? game.prompt_word : null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Start a round.
 *
 * By default this opens a room and makes the player the drawer, waiting for a
 * human guesser. With `opponent: 'bot'` it sets up a practice round instead:
 * Kibry Bot draws and the player guesses. Either way the server picks the
 * secret word — the browser never gets to choose it.
 */
export const createGame = async (req, res, next) => {
  try {
    assertValid(req);

    // Who is playing comes from the token, never from the body.
    const user_id = req.user.user_id;
    const { difficulty } = req.body;

    // The token proved who they are, but the account could have been deleted
    // since it was issued, so the row is still checked.
    const user = await findUserById(user_id);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    await closeAbandonedRooms(user_id);

    if (req.body.opponent === 'bot') {
      // Kibry Bot's pictures are drawn ahead of time by `npm run draw`, so this
      // is a database read rather than a wait — the round starts straight away.
      const picture = await findRandomBotDrawing(difficulty);

      if (!picture) {
        throw new AppError(
          'NOT_FOUND',
          `Kibry Bot has not learned any ${difficulty} words yet. ` +
          `Run "npm run draw ${difficulty}" to teach it some, then "npm run db".`
        );
      }

      const practice = await insertGame({
        room_code: await generateRoomCode(),
        mode: 'ai',
        guesser_id: user_id,
        // The word comes from the picture, so they always match.
        prompt_word: picture.word,
        difficulty,
        status: 'drawing',
        started_at: new Date().toISOString(),
        ai_strokes: picture.strokes,
      });

      // The player is the guesser this time, so the word stays hidden.
      return res.status(201).json({
        game_id: practice.game_id,
        mode: practice.mode,
        guesser_id: practice.guesser_id,
        difficulty: practice.difficulty,
        status: practice.status,
        started_at: practice.started_at,
      });
    }

    const game = await insertGame({
      room_code: await generateRoomCode(),
      mode: 'pvp',
      drawer_id: user_id,
      prompt_word: pickRandomWord(difficulty),
      difficulty,
      status: 'waiting',
    });

    // Only the drawer ever sees this response, so the prompt is included.
    res.status(201).json(game);
  } catch (error) {
    next(error);
  }
};

/** Join somebody else's room as the guesser, using their room code. */
export const joinGameByRoomCode = async (req, res, next) => {
  try {
    assertValid(req);

    const { room_code } = req.body;
    const user_id = req.user.user_id;

    const user = await findUserById(user_id);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    const game = await findGameByRoomCode(room_code.trim().toUpperCase());
    if (!game) throw new AppError('NOT_FOUND', 'No room with that code');

    const result = await joinGame(game.game_id, user_id);

    if (!result) throw new AppError('NOT_FOUND', 'No room with that code');
    if (result.sameUser) throw new AppError('CONFLICT', 'You cannot join your own room — send the code to a friend');
    if (result.notWaiting) throw new AppError('CONFLICT', 'That room is not open any more');

    res.status(200).json({
      game_id: result.game_id,
      room_code: result.room_code,
      drawer_id: result.drawer_id,
      guesser_id: result.guesser_id,
      difficulty: result.difficulty,
      status: result.status,
      started_at: result.started_at,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * The endpoint both browsers poll about once a second.
 *
 * What comes back depends on who is asking: the drawer gets the prompt word,
 * and the guesser gets a blanked-out hint instead until the round is over.
 */
export const getGameState = async (req, res, next) => {
  try {
    const found = await findGameById(req.params.id);
    if (!found) throw new AppError('NOT_FOUND', 'Game not found');

    let game = found;

    // Whoever polls first is the one who notices the clock hit zero.
    if (game.status === 'drawing' && secondsLeftInGame(game) <= 0) {
      const timedOut = await endGame(game.game_id, 'timeout');
      if (timedOut && !timedOut.alreadyEnded) game = timedOut;
    }

    // Taken from the token, so a player can only ever ask for their own view of
    // the round — a guesser cannot request the drawer's view and read the word.
    const viewerId = req.user.user_id;
    const role = findRoleInGame(game, viewerId);
    const finished = isGameOver(game);
    const showPrompt = role === 'drawer' || finished;
    const isPractice = game.mode === 'ai';

    const gameGuesses = await findGuessesByGameId(game.game_id);

    res.status(200).json({
      game_id: game.game_id,
      room_code: game.room_code,
      mode: game.mode,
      status: game.status,
      difficulty: game.difficulty,
      role,
      drawer: await describePlayer(game.drawer_id),
      guesser: await describePlayer(game.guesser_id),
      seconds_left: finished ? 0 : secondsLeftInGame(game),
      canvas_version: game.canvas_version,
      // Practice rounds arrive as brush strokes rather than a picture, and
      // only the ones the bot has "drawn" so far are ever sent.
      strokes: isPractice ? visibleAiStrokes(game) : [],
      prompt_word: showPrompt ? game.prompt_word : null,
      prompt_hint: buildPromptHint(game.prompt_word),
      winning_guess: game.winning_guess,
      points_earned: game.status === 'won' && !isPractice ? POINTS_BY_DIFFICULTY[game.difficulty] : 0,
      guesses: gameGuesses,
    });
  } catch (error) {
    next(error);
  }
};

/** Get the drawer's latest picture. This is what the guesser watches. */
export const getGameCanvas = async (req, res, next) => {
  try {
    const game = await findGameById(req.params.id);

    if (!game) throw new AppError('NOT_FOUND', 'Game not found');

    res.status(200).json({
      game_id: game.game_id,
      canvas_version: game.canvas_version,
      canvas_data: game.canvas_data,
    });
  } catch (error) {
    next(error);
  }
};

/** Save the drawer's picture so the guesser's next poll can pick it up. */
export const updateGameCanvas = async (req, res, next) => {
  try {
    assertValid(req);

    const { canvas_data } = req.body;
    const user_id = req.user.user_id;

    const game = await findGameById(req.params.id);
    if (!game) throw new AppError('NOT_FOUND', 'Game not found');

    if (game.drawer_id !== user_id) {
      throw new AppError('UNAUTHORIZED', 'Only the drawer can draw in this room');
    }

    const result = await saveGameCanvas(req.params.id, canvas_data);

    if (!result) throw new AppError('NOT_FOUND', 'Game not found');
    if (result.notActive) throw new AppError('CONFLICT', 'This round is not running');

    res.status(200).json({
      game_id: result.game_id,
      canvas_version: result.canvas_version,
    });
  } catch (error) {
    next(error);
  }
};

/** Get every guess made in a game, oldest first. */
export const getGameGuesses = async (req, res, next) => {
  try {
    const game = await findGameById(req.params.id);

    if (!game) throw new AppError('NOT_FOUND', 'Game not found');

    const gameGuesses = await findGuessesByGameId(req.params.id);

    res.status(200).json(gameGuesses);
  } catch (error) {
    next(error);
  }
};

/** Send a guess. A correct one ends the round and pays both players. */
export const createGuess = async (req, res, next) => {
  try {
    assertValid(req);

    const { guess } = req.body;
    const user_id = req.user.user_id;

    const result = await insertGuess(req.params.id, user_id, guess);

    if (!result) throw new AppError('NOT_FOUND', 'Game not found');
    if (result.notGuesser) throw new AppError('UNAUTHORIZED', 'Only the guesser can guess in this room');
    if (result.notActive) throw new AppError('CONFLICT', 'This round is already over');
    if (result.expired) throw new AppError('CONFLICT', 'Time is up — that guess came in too late');

    if (!result.correct) {
      return res.status(201).json({
        message: 'Not quite — keep going!',
        correct: false,
        guess_text: result.guess_text,
      });
    }

    res.status(201).json({
      message: `Correct! You both earned ${result.pointsEarned} points.`,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

/** Quit a round early. Either player can do it, and nobody scores. */
export const endGameById = async (req, res, next) => {
  try {
    const user_id = req.user.user_id;

    const game = await findGameById(req.params.id);
    if (!game) throw new AppError('NOT_FOUND', 'Game not found');

    if (findRoleInGame(game, user_id) === 'spectator') {
      throw new AppError('UNAUTHORIZED', 'Only the players in this room can end it');
    }

    const result = await endGame(req.params.id, 'abandoned');

    if (!result) throw new AppError('NOT_FOUND', 'Game not found');
    if (result.alreadyEnded) throw new AppError('CONFLICT', 'This round is already over');

    res.status(200).json({
      message: 'Round ended. Nobody scored this time.',
      game_id: result.game_id,
      status: result.status,
      prompt_word: result.prompt_word,
    });
  } catch (error) {
    next(error);
  }
};

/** Delete a game by ID. Only the players who were in it may do this. */
export const deleteGame = async (req, res, next) => {
  try {
    const existing = await findGameById(req.params.id);

    if (!existing) throw new AppError('NOT_FOUND', 'Game not found');

    if (findRoleInGame(existing, req.user.user_id) === 'spectator') {
      throw new AppError('UNAUTHORIZED', 'Only the players in this room can delete it');
    }

    const game = await removeGame(req.params.id);

    if (!game) throw new AppError('NOT_FOUND', 'Game not found');

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
