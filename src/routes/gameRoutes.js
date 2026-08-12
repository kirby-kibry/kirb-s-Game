import { Router } from 'express';
import { body } from 'express-validator';
import {
  getAllGames,
  getGameById,
  getGameState,
  getGameCanvas,
  getGameGuesses,
  createGame,
  joinGameByRoomCode,
  updateGameCanvas,
  createGuess,
  endGameById,
  deleteGame,
} from '../controllers/gameController.js';
import { requireAuth } from '../middlewares/auth.js';

export const gameRouter = Router();

// Every route here is part of playing a round, so all of them need a signed-in
// player. requireAuth runs first on each one and puts the player on req.user —
// which is why none of these routes take a user_id any more. The old validators
// for it are gone: a body cannot prove who you are, and a token can.
gameRouter.use(requireAuth);

gameRouter.get('/', getAllGames);
gameRouter.get('/:id', getGameById);
gameRouter.get('/:id/canvas', getGameCanvas);
gameRouter.get('/:id/guesses', getGameGuesses);

// The endpoint both browsers poll while a round is running. Who is asking comes
// from the token, so the drawer cannot ask for the guesser's view or vice versa.
gameRouter.get('/:id/state', getGameState);

// Note: the prompt word is not accepted here on purpose. The server picks it so
// that the guesser can never read the answer out of the page source.
gameRouter.post(
  '/',
  [
    body('difficulty').isIn(['easy', 'medium', 'hard']).withMessage('Difficulty must be easy, medium, or hard'),
    body('opponent').optional().isIn(['player', 'bot']).withMessage('Opponent must be player or bot'),
  ],
  createGame
);

// Players join by typing the drawer's room code, not a game ID, so this is a
// fixed path rather than '/:id/join'.
gameRouter.post(
  '/join',
  [body('room_code').trim().notEmpty().withMessage('Room code is required')],
  joinGameByRoomCode
);

gameRouter.put(
  '/:id/canvas',
  [body('canvas_data').isString().withMessage('Canvas data must be a string')],
  updateGameCanvas
);

gameRouter.post(
  '/:id/guesses',
  [
    body('guess').trim().notEmpty().withMessage('Guess cannot be empty')
      .isLength({ max: 40 }).withMessage('Guess must be 40 characters or fewer'),
  ],
  createGuess
);

gameRouter.post('/:id/end', endGameById);

gameRouter.delete('/:id', deleteGame);
