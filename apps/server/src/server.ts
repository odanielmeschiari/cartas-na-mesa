import { Server, WebSocketTransport } from 'colyseus';
import { createServer } from 'http';
import { FixtureRoom } from './rooms/fixture';

const port = Number(process.env.PORT) || 3001;

const httpServer = createServer();
const transport = new WebSocketTransport({ server: httpServer });

const colyseusServer = new Server({
  transport,
});

colyseusServer.define('fixture', FixtureRoom);

httpServer.listen(port, () => {
  console.log(`Cartas na Mesa — servidor Colyseus ouvindo na porta ${port}`);
});

export { colyseusServer };
