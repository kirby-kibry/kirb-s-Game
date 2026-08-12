import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { cosmetics, user_cosmetics, users } from '../db/schema.js';

export { cosmetics, user_cosmetics };

/** Get all cosmetics in the shop, cheapest first. */
export const findAllCosmetics = async () => {
  return await db.select().from(cosmetics).orderBy(cosmetics.price);
};

/** Get a single cosmetic by ID. Returns undefined if not found. */
export const findCosmeticById = async (cosmetic_id) => {
  const rows = await db.select().from(cosmetics).where(eq(cosmetics.cosmetic_id, cosmetic_id));
  return rows[0];
};

/** Get every cosmetic a user owns, with its shop details. */
export const findCosmeticsByUserId = async (user_id) => {
  return await db
    .select({
      cosmetic_id: cosmetics.cosmetic_id,
      name: cosmetics.name,
      description: cosmetics.description,
      price: cosmetics.price,
      css_value: cosmetics.css_value,
      purchased_at: user_cosmetics.purchased_at,
    })
    .from(user_cosmetics)
    .innerJoin(cosmetics, eq(user_cosmetics.cosmetic_id, cosmetics.cosmetic_id))
    .where(eq(user_cosmetics.user_id, user_id));
};

/**
 * Buy a cosmetic: deduct the points and record ownership in one transaction,
 * so a failure can never leave the user out of pocket with nothing to show.
 *
 * Ownership and affordability are re-checked inside the transaction, which is
 * what stops two simultaneous requests from buying the same item twice.
 *
 * Returns `{ alreadyOwned: true }`, `{ insufficientPoints: true, points }`,
 * or the successful purchase summary.
 */
export const purchaseCosmetic = async (user_id, cosmetic_id, price) => {
  return await db.transaction(async (tx) => {
    const owned = await tx
      .select()
      .from(user_cosmetics)
      .where(and(eq(user_cosmetics.user_id, user_id), eq(user_cosmetics.cosmetic_id, cosmetic_id)));

    if (owned.length > 0) return { alreadyOwned: true };

    const userRows = await tx.select({ points: users.points }).from(users).where(eq(users.user_id, user_id));

    if (userRows[0].points < price) {
      return { insufficientPoints: true, points: userRows[0].points };
    }

    const updatedUser = await tx
      .update(users)
      .set({ points: sql`${users.points} - ${price}` })
      .where(eq(users.user_id, user_id))
      .returning({ points: users.points });

    const purchase = await tx
      .insert(user_cosmetics)
      .values({ user_id, cosmetic_id })
      .returning();

    return { updatedPoints: updatedUser[0].points, purchase: purchase[0] };
  });
};
