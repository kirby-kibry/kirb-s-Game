/**
 * Cosmetic Card Component
 *
 * Builds one shop tile. The same component covers all three states — buyable,
 * too expensive, and already owned — so the shop page stays simple.
 *
 * Usage:
 *   import { createCosmeticCard } from '../components/cosmetic-card.js';
 *
 *   const card = createCosmeticCard(cosmetic, {
 *     owned: true,
 *     equipped: false,
 *     points: 120,
 *     onBuy: (cosmeticId) => { ... },
 *     onEquip: (cosmetic) => { ... },
 *   });
 */

/**
 * Create a shop tile for one cosmetic.
 *
 * @param {Object} cosmetic - A cosmetic from the API.
 * @param {Object} state - How to render it.
 * @param {boolean} state.owned - Whether the player already owns it.
 * @param {boolean} state.equipped - Whether it is the active border.
 * @param {number} state.points - The player's current points balance.
 * @param {Function} state.onBuy - Called with (cosmetic_id) when Buy is clicked.
 * @param {Function} state.onEquip - Called with (cosmetic) when Equip is clicked.
 * @returns {HTMLElement} The finished card element.
 */
export const createCosmeticCard = (cosmetic, { owned, equipped, points, onBuy, onEquip }) => {
  const card = document.createElement('article');
  card.classList.add('cosmetic-card');
  if (owned) card.classList.add('owned');

  // A small square showing what the border actually looks like.
  const preview = document.createElement('div');
  preview.classList.add('cosmetic-preview');
  preview.style.border = cosmetic.css_value;
  preview.dataset.cosmetic = cosmetic.cosmetic_id;

  const name = document.createElement('h3');
  name.textContent = cosmetic.name;

  const description = document.createElement('p');
  description.classList.add('cosmetic-description');
  description.textContent = cosmetic.description;

  const price = document.createElement('p');
  price.classList.add('cosmetic-price');
  price.textContent = owned ? 'Owned' : `${cosmetic.price} points`;

  const button = document.createElement('button');

  if (owned) {
    button.textContent = equipped ? 'Equipped' : 'Equip';
    button.classList.add('equip-btn');
    button.disabled = equipped;
    button.addEventListener('click', () => onEquip(cosmetic));
  } else {
    const affordable = points >= cosmetic.price;
    button.textContent = affordable ? 'Buy' : `Need ${cosmetic.price - points} more`;
    button.classList.add('buy-btn');
    button.disabled = !affordable;
    button.addEventListener('click', () => onBuy(cosmetic.cosmetic_id));
  }

  card.appendChild(preview);
  card.appendChild(name);
  card.appendChild(description);
  card.appendChild(price);
  card.appendChild(button);

  return card;
};
