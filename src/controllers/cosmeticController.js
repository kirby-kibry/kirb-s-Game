import {
  findAllCosmetics,
  findCosmeticById,
  findCosmeticsByUserId,
  purchaseCosmetic,
} from '../models/cosmeticModel.js';
import { findUserById } from '../models/userModel.js';
import { AppError } from '../utils/_errors.js';

/** Browse the shop. */
export const getAllCosmetics = async (req, res, next) => {
  try {
    const cosmetics = await findAllCosmetics();
    res.status(200).json(cosmetics);
  } catch (error) {
    next(error);
  }
};

/** View the cosmetics a user owns. */
export const getUserCosmetics = async (req, res, next) => {
  try {
    const user = await findUserById(req.params.id);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    const owned = await findCosmeticsByUserId(req.params.id);
    res.status(200).json(owned);
  } catch (error) {
    next(error);
  }
};

/**
 * Buy a cosmetic with earned points.
 *
 * The buyer is taken from the token, not the body — otherwise anyone could post
 * another player's id here and spend the points they earned.
 */
export const buyCosmetic = async (req, res, next) => {
  try {
    const cosmetic_id = req.params.id;
    const user_id = req.user.user_id;

    const cosmetic = await findCosmeticById(cosmetic_id);
    if (!cosmetic) throw new AppError('NOT_FOUND', 'Cosmetic not found');

    const user = await findUserById(user_id);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    const result = await purchaseCosmetic(user_id, cosmetic_id, cosmetic.price);

    if (result.alreadyOwned) {
      throw new AppError('CONFLICT', 'You already own this cosmetic');
    }

    if (result.insufficientPoints) {
      throw new AppError(
        'INSUFFICIENT_POINTS',
        `You need ${cosmetic.price} points but only have ${result.points}`
      );
    }

    res.status(200).json({
      message: `Successfully purchased ${cosmetic.name}!`,
      pointsSpent: cosmetic.price,
      remainingPoints: result.updatedPoints,
    });
  } catch (error) {
    next(error);
  }
};
