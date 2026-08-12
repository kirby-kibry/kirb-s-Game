import { Router } from 'express';
import { body, query } from 'express-validator';
import {
  getAllUsers,
  getLeaderboard,
  getUserById,
  createUser,
  loginUser,
  updateUserById,
  deleteUser,
} from '../controllers/userController.js';
import { getUserCosmetics } from '../controllers/cosmeticController.js';
import { requireAuth, requireSelf } from '../middlewares/auth.js';

export const userRouter = Router();

// --- Public: the two ways in ---
// Registering and logging in cannot require a token, because getting a token is
// the whole point of them.

userRouter.post(
  '/',
  [
    body('username').trim().notEmpty().withMessage('Username is required')
      .isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters'),
    body('password').notEmpty().withMessage('Password is required')
      .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  createUser
);

userRouter.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  loginUser
);

// The leaderboard is a public scoreboard — it is only usernames and scores, and
// leaving it open means it can be linked to without an account. Static paths
// must be declared before '/:id', or '/leaderboard' would be read as a user ID.
userRouter.get(
  '/leaderboard',
  [
    query('limit').optional().isInt({ min: 1, max: 100 })
      .withMessage('Limit must be a whole number between 1 and 100'),
  ],
  getLeaderboard
);

// --- Signed in only ---

userRouter.get('/', requireAuth, getAllUsers);
userRouter.get('/:id', requireAuth, getUserById);
userRouter.get('/:id/cosmetics', requireAuth, getUserCosmetics);

// requireSelf on top of requireAuth: being signed in as somebody is not the
// same as being allowed to rename or delete anybody.
userRouter.put(
  '/:id',
  requireAuth,
  requireSelf,
  [
    body('username').optional().trim().notEmpty().withMessage('Username cannot be empty')
      .isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters'),
  ],
  updateUserById
);

userRouter.delete('/:id', requireAuth, requireSelf, deleteUser);
