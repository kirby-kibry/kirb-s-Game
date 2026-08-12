import 'dotenv/config';
import os from 'os';
import express from 'express';
import cors from 'cors';
import { userRouter } from './src/routes/userRoutes.js';
import { gameRouter } from './src/routes/gameRoutes.js';
import { cosmeticRouter } from './src/routes/cosmeticRoutes.js';
import { setupSwagger } from './_extras/api-docs/swagger.js';
import { errorHandler } from './src/utils/_errors.js';
import { handleRequestErrors, handleUnknownApiRoute } from './src/middlewares/requestErrors.js';

const app = express();

// Middleware
app.use(cors());
// Canvas pictures are sent as base64 data URLs, which are larger than the
// default 100kb JSON limit.
app.use(express.json({ limit: '5mb' }));
app.use(express.static('src/frontend'));

// Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/users', userRouter);
app.use('/api/games', gameRouter);
app.use('/api/cosmetics', cosmeticRouter);

// Swagger API docs
await setupSwagger(app);

// Anything under /api that matched no route above. Declared after the routes so
// it only sees what they did not handle.
app.use('/api', handleUnknownApiRoute);

// Error handling, in order: framework failures are reshaped first, then the
// global handler turns everything into the standard JSON error body.
app.use(handleRequestErrors);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

/**
 * Find the addresses this computer can be reached at from another machine.
 * Loopback addresses are left out because only this computer can use those.
 *
 * @returns {Array<{name: string, address: string}>} One entry per network card.
 */
const findNetworkAddresses = () => {
  const addresses = [];

  for (const [name, cards] of Object.entries(os.networkInterfaces())) {
    for (const card of cards) {
      if (card.family === 'IPv4' && !card.internal) {
        addresses.push({ name, address: card.address });
      }
    }
  }

  return addresses;
};

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API docs at http://localhost:${PORT}/api-docs`);

  // The game needs two players, so print the addresses a second laptop on the
  // same network can open. Pick the one for your Wi-Fi adapter.
  console.log('\nFor another laptop on the same network:');

  for (const { name, address } of findNetworkAddresses()) {
    console.log(`  ${name}: http://${address}:${PORT}`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try a different port by setting the PORT environment variable.`);
    process.exit(1);
  }
  throw err;
});

export default app;
