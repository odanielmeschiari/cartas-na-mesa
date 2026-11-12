import { createGameServer } from './server';

const port = Number(process.env.PORT) || 3001;

const server = createGameServer();

try {
  await server.listen(port);
  console.log(`Cartas na Mesa — servidor Colyseus ouvindo na porta ${port}`);
} catch (error) {
  console.error('Falha ao iniciar o servidor do Colyseus:', error);
  process.exitCode = 1;
  process.exit(1);
}
