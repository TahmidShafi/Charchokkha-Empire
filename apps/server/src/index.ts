import { createAppServer } from './server.js';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const host = process.env.HOST ?? '0.0.0.0';

const server = createAppServer({ port, host });

server.start(port, host).then((actualPort) => {
  // eslint-disable-next-line no-console
  console.log(`[Charchokkha Server] Running on http://${host}:${actualPort}`);
  // eslint-disable-next-line no-console
  console.log(`[Charchokkha Server] Health check available at http://${host}:${actualPort}/health`);
});

const handleShutdown = async (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`\n[Charchokkha Server] Received ${signal}. Shutting down gracefully...`);
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
