import { Router } from 'express';
import { getAllCosmetics, buyCosmetic } from '../controllers/cosmeticController.js';
import { requireAuth } from '../middlewares/auth.js';

export const cosmeticRouter = Router();

// Browsing and buying both need a signed-in player: the shop shows what you can
// afford, and a purchase spends points. The buyer comes from the token, so the
// old body('user_id') validator is gone — otherwise anyone could post somebody
// else's id and spend their points for them.
cosmeticRouter.use(requireAuth);

cosmeticRouter.get('/', getAllCosmetics);

cosmeticRouter.post('/:id/buy', buyCosmetic);
