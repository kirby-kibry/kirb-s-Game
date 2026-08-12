/**
 * shop.js — browse, buy, and equip cosmetic canvas borders.
 */

import { fetchUser, fetchShop, fetchOwnedCosmetics, buyCosmetic, SESSION_EXPIRED_EVENT } from './api.js';
import { requireSession, saveEquippedBorder, loadEquippedBorder } from './session.js';
import { createCosmeticCard } from './components/cosmetic-card.js';

const session = requireSession();

// Every endpoint this page uses needs a signed-in player, so there is nothing
// worth showing once the token expires — send them back to sign in again.
window.addEventListener(SESSION_EXPIRED_EVENT, () => {
  window.location.href = 'index.html';
});

const playerName = document.getElementById('player-name');
const playerPoints = document.getElementById('player-points');
const shopGrid = document.getElementById('shop-grid');
const shopMessage = document.getElementById('shop-message');
const equippedName = document.getElementById('equipped-name');
const unequipBtn = document.getElementById('unequip-btn');

/** Show a message to the player. Pass isError to style it red. */
const showMessage = (text, isError = false) => {
  shopMessage.textContent = text;
  shopMessage.classList.toggle('error', isError);
};

/** Describe which border is currently in use. */
const renderEquipped = () => {
  const equipped = loadEquippedBorder();

  equippedName.textContent = equipped
    ? `${equipped.name} — shown around your drawing canvas.`
    : 'None — your canvas uses the plain border.';

  unequipBtn.disabled = !equipped;
};

/** Fetch everything the page needs and rebuild the grid. */
const loadShop = async () => {
  try {
    const [user, catalog, owned] = await Promise.all([
      fetchUser(session.user_id),
      fetchShop(),
      fetchOwnedCosmetics(session.user_id),
    ]);

    playerName.textContent = user.username;
    playerPoints.textContent = user.points;

    const ownedIds = owned.map((cosmetic) => cosmetic.cosmetic_id);
    const equipped = loadEquippedBorder();

    shopGrid.innerHTML = '';

    catalog.forEach((cosmetic) => {
      const card = createCosmeticCard(cosmetic, {
        owned: ownedIds.includes(cosmetic.cosmetic_id),
        equipped: Boolean(equipped) && equipped.cosmetic_id === cosmetic.cosmetic_id,
        points: user.points,
        onBuy: handleBuy,
        onEquip: handleEquip,
      });

      shopGrid.appendChild(card);
    });

    showMessage('');
    renderEquipped();
  } catch (error) {
    showMessage(error.message, true);
  }
};

/** Buy a cosmetic, then reload so prices and balances stay in sync. */
const handleBuy = async (cosmeticId) => {
  showMessage('Purchasing...');

  try {
    const result = await buyCosmetic(cosmeticId);
    await loadShop();
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message, true);
  }
};

/** Equip an owned cosmetic so it appears around the game canvas. */
const handleEquip = async (cosmetic) => {
  saveEquippedBorder(cosmetic);
  await loadShop();
  showMessage(`${cosmetic.name} equipped.`);
};

unequipBtn.addEventListener('click', async () => {
  saveEquippedBorder(null);
  await loadShop();
  showMessage('Back to the plain border.');
});

loadShop();
