# 0002 — Mecanismo de tempo real do Colyseus 0.18 (spike)

- **Status:** aceito para implementação do passo 4
- **Data:** 2026-11-12
- **Fonte:** `AGENTS.md`, `docs/adr/0001-stack.md`, `docs/architecture/0001-fixture-contract.md`, `next_tasks.md` (item 4)
- **Escopo:** mecanismo concreto de salas, mensagens e reconexão sobre Colyseus 0.18 que satisfaz o contrato de rede do passo 4; não implementa código nem define regra de jogo.

## 1. Decisão do mecanismo

O `RoomCode` **é** o `roomId` do Colyseus. A sala é criada por `onCreate`, que gera um código curto com
CSPRNG e faz `this.roomId = roomCode`; o cache do driver e a referência interna da sala passam a usar
o código final **depois** de `onCreate` (`MatchMaker.cjs:387` e `MatchMaker.cjs:420`). Consequência
direta: `matchMaker.joinById(roomCode)` encontra a sala, e a reserva de assento devolvida ao cliente
traz `roomId: room.roomId`, ou seja, o próprio código curto (`MatchMaker.cjs:595-609`).

A identidade do jogador (apelido, avatar) **não** vem do `options` do matchmaking: vem da mensagem
`create_room` / `join_room`, enviada pelo cliente depois que o WebSocket abre. O motivo é contratual
e não técnico: o contrato §5 define essas mensagens dentro de `clientMessageSchema`, e o cliente
precisa estar conectado a uma sala para enviá-las.

O assento de jogo (`seatIndex` 0/1) é conceito do **motor**, distinto da reserva de assento do
Colyseus. A reserva do Colyseus limita conexões concorrentes e protege contra `room_full`; o assento
de jogo é atribuído quando a mensagem de identidade chega.

A seed da partida é gerada **no servidor**, por CSPRNG, dentro da sala, por um método `protected`
sobrescrevível que nenhum cliente alcança (ver §4).

O estado privado é entregue por **mensagem privada explícita** (`state_private` só para o dono),
não por filtro de `StateView` de schema. O contrato §6 admite "filtro por cliente no `StateView`,
mensagem privada ou combinação"; o spike usa a segunda forma. Emenda ao ADR-001 preparada em §10.

### 1.1 Fluxo de criação

| # | Cliente | Servidor |
| --- | --- | --- |
| 1 | `sdk.create('fixture')` → HTTP `POST /matchmake/create/fixture` | — |
| 2 | — | `handleCreateRoom` instancia a sala, chama `onCreate`; `onCreate` gera o código com CSPRNG e faz `this.roomId = roomCode` (aceito porque `_internalState` ainda é `CREATING`) |
| 3 | — | `_listing.roomId = room.roomId`; `createRoomReferences` registra `rooms[roomCode] = room`; o driver indexa o listing pelo código final |
| 4 | — | Reserva de assento: `buildSeatReservation` devolve `{ name, sessionId, roomId: roomCode, processId }` |
| 5 | Abre o WebSocket em `/{processId}/{roomCode}`; o handshake `JOIN_ROOM` consome a reserva (`_onJoin` → `onJoin`) | `onJoin` **não** senta ninguém: apenas registra a conexão Colyseus |
| 6 | Envia `create_room { nickname, avatarId }` | Valida com Zod; recusa se o emissor já tem assento de jogo; atribui `playerId` (UUID), `seatIndex` e `sessionToken` (CSPRNG) |
| 7 | — | Responde `join_accepted { roomCode, matchId, playerId, seatIndex, sessionToken }` **somente ao remetente** |
| 8 | — | Ainda falta o segundo assento: responde `room_waiting { roomCode, seats }` a **todos os jogadores sentados e conectados** (nesta etapa, só o remetente); `state_public`/`state_private` não existem enquanto a partida não começou (contrato §5) |

> **`room_waiting` não é mensagem do remetente.** Enquanto a partida não começou, o servidor envia
> `room_waiting` a **todos os jogadores sentados e conectados** da sala (`publishState`), e não
> apenas a quem deu a identidade. Isso é o comportamento adequado: o contrato §5 exige apenas que
> `room_waiting` exista antes do segundo assento, sem exigir exclusividade; o payload é público
> (`roomCode` e a lista de assentos) e não carrega nada de privado; e todos os sentados passam a
> ver a mesma presença, sem divergência entre eles.

### 1.2 Fluxo de entrada por código

| # | Cliente | Servidor |
| --- | --- | --- |
| 1 | `sdk.joinById(roomCode)` → HTTP `POST /matchmake/joinById/{roomCode}` (o código vai na URL) | `driver.findOne({ roomId: roomCode })`; se não existir, `MATCHMAKE_INVALID_ROOM_ID`; se a sala estiver cheia no limite de conexões, `SeatReservationError` |
| 2 | — | Reserva de assento: `buildSeatReservation` devolve `roomId: roomCode` |
| 3 | Abre o WebSocket em `/{processId}/{roomCode}`; o handshake consome a reserva | `onJoin` roda sem sentar ninguém no jogo |
| 4 | Envia `join_room { roomCode, nickname, avatarId }` | Valida com Zod |
| 5 | — | Compara `payload.roomCode` com `this.roomId`: divergência ⇒ `error { code: 'room_not_found' }` **somente ao remetente** |
| 6 | — | Atribui `playerId`, `seatIndex` e `sessionToken`; responde `join_accepted` **somente ao remetente** |
| 7 | — | Se a partida ainda não começou: `room_waiting` a **todos os jogadores sentados e conectados** (ver a nota da §1.1). Se começou (2 assentos de jogo): `state_public` por broadcast + `state_private` **só para este cliente** |

### 1.3 Fluxo de reconexão

| # | Cliente | Servidor |
| --- | --- | --- |
| 1 | `sdk.joinById(roomCode)` (mesma URL do fluxo de entrada) | Mesma reserva de assento do fluxo §1.2; o cliente reconectante entra como **nova conexão Colyseus**, com `sessionId` novo |
| 2 | Envia `reconnect { roomCode, sessionToken }` | Valida com Zod e compara `payload.roomCode` com `this.roomId`; divergência ⇒ `error { code: 'room_not_found' }` |
| 3 | — | Procura a sessão de jogo pelo `sessionToken`. Não encontrada ⇒ `error { code: 'session_invalid' }` **somente ao remetente** |
| 4 | — | Encontrada: **reassenta** o mesmo `playerId` e o mesmo `seatIndex`; a conexão Colyseus antiga é encerrada e a nova assume a sessão de jogo |
| 5 | — | Reemite `join_accepted` (mesmo `matchId`/`playerId`/`seatIndex`, mesmo `sessionToken`) **somente ao remetente** |
| 6 | — | Reemite `state_public` por broadcast (o `connected` do assento volta a `true`) e `state_private` **só para o cliente reconectante** (contrato §6) |

Consequências que a implementação do spike precisa respeitar:

- `onLeave` **não** libera o assento de jogo: marca `connected: false` e preserva `playerId`/`seatIndex`
  para a reconexão. Por isso `connected` em `SeatInfo` é derivado do mapa de sessões de jogo do
  servidor, e **não** de `this.clients` do Colyseus (as duas coisas estão desacopladas).
- `onJoin` roda de novo na reconexão (novo `sessionId` Colyseus). Como o assento de jogo só é
  atribuído na mensagem de identidade, `onJoin` nunca cria jogador de jogo — evita assento duplicado.
- O `sessionToken` do aplicativo e o `reconnectionToken` nativo do Colyseus são **mecanismos
  paralelos e incompatíveis**. O nativo exige o formato `roomId:token` e o fluxo `sdk.reconnect(token)`
  (`sdk/src/Client.ts:297-305`), com `allowReconnection(client, seconds)` chamado dentro de `onLeave`
  (`Room.cjs:1274-1325`). O `sessionToken` do projeto é opaco, vinculado à sessão de **jogo**
  (`playerId`/`seatIndex`), entregue em `join_accepted` e reaplicado por **mensagem** após
  `sdk.joinById`. O spike usa exclusivamente o segundo.
- **Limite de conexões e reconexão.** Com `maxClients = 2`, a reconexão só passa pelo matchmaking
  se ainda houver vaga no limite de **conexões Colyseus**. Um cliente cuja conexão antiga **ainda
  está viva** (aba duplicada, recarregamento antes de o servidor perceber a queda) é barrado **na
  reserva de assento do matchmaking**, antes de qualquer mensagem: o `SeatReservationError`
  ("… is already full") chega como falha de `sdk.joinById`, não como `error` de protocolo. A borda
  do cliente deve tratar essa falha de matchmaking como **`room_full`**, com a mesma tradução da
  §5.1 — e não como erro de sessão.

## 2. Identificadores

| Identificador | Forma | Gerado por | Quem conhece | Cliente pode influenciar? |
| --- | --- | --- | --- | --- |
| `roomCode` | string opaca; **igual ao `roomId` do Colyseus**; 6 caracteres do alfabeto sem ambiguidade (formato final adiado, §8) | Servidor, CSPRNG, em `onCreate` | O dono e quem recebeu o código; viaja na URL do matchmaking | Não |
| `matchId` | UUID (`crypto.randomUUID()`) | Servidor, na criação da sala | Os jogadores da sala; vai em `join_accepted`, `state_public`, `state_private`, `events` | Não |
| `playerId` | UUID (`crypto.randomUUID()`) | Servidor, ao sentar o jogador | O próprio jogador e todos os da sala (`seats`, `state_public.game`) | Não |
| `seatIndex` | Inteiro ≥ 0; `0` ou `1` no fixture | Servidor, ao sentar o jogador | Todos os da sala | Não |
| `sessionToken` | String opaca de alta entropia (CSPRNG) | Servidor, ao sentar o jogador | **Somente o dono**, na mensagem privada `join_accepted` | Não |

Regras que decorrem:

- `playerId` nunca é aceito do cliente: `action_intent` não o carrega (contrato §5) e o servidor o
  resolve da sessão (ver §5, erros `session_invalid`).
- `sessionToken` nunca entra em estado sincronizado nem em `broadcast` (contrato §6).
- `matchId` diverge do da sala ⇒ `match_not_found` (§5).
- `roomCode` é opaco na borda: o contrato §2 não fixa formato e o cliente nunca o interpreta.

## 3. Aleatoriedade

| Valor | Fonte | Onde é gerado | Cliente pode influenciar? |
| --- | --- | --- | --- |
| `roomCode` | CSPRNG (`crypto.getRandomValues`) | Servidor, em `onCreate`, antes de `this.roomId = roomCode` | Não |
| `sessionToken` | CSPRNG (`crypto.getRandomValues`) | Servidor, ao sentar o jogador | Não |
| `playerId`, `matchId` | `crypto.randomUUID()` (CSPRNG) | Servidor | Não |
| Seed da partida | CSPRNG, **gerada dentro da sala, por partida** | Servidor, via método `protected` (§4) | Não |
| Embaralhamento e distribuição de cartas | `Rng` semeado de `packages/core` (`createSeededRng`), alimentado pela seed da partida | `packages/core`, dentro de `createInitialState` | Não |
| `reconnectionToken` nativo do Colyseus | `generateId()` interno do Colyseus | Colyseus, em `_onJoin` (`Room.cjs:1132`) | Não |

Regras:

- **Proibido `Math.random`** em qualquer caminho do servidor (regra 11 do `AGENTS.md`). A primeira
  versão da sala gerava o código de sala com `Math.random`; hoje a aleatoriedade de produção vem
  de `apps/server/src/rooms/random.ts`, único módulo do servidor que sorteia bytes
  (`cryptoRandomBytes`, o CSPRNG da plataforma) e os converte em **código de sala**
  (`randomRoomCode`), **token de sessão** (`randomSessionToken`) e **seed da partida**
  (`randomUint32`). Não há `Math.random` em nenhum caminho de produção.
- **Proibido RNG global compartilhado.** Cada sala tem a sua própria seed e o seu próprio `Rng`.
- A seed **nunca** trafega: nem em `state_public`, nem em `state_private`, nem em `events`
  (contrato §4: "Eventos são públicos e nunca contêm carta de mão, baralho restante ou seed").
- A seed da partida é gerada **no servidor**, e não pode ser lida de `options` do matchmaking
  (justificativa em §4).

## 4. Costura para teste determinístico

### 4.1 Decisão

A sala de produção expõe um método `protected` que produz a seed da partida, e o teste o
sobrescreve:

```ts
// apps/server/src/rooms/<sala>.ts — forma prevista
protected createMatchSeed(): number {
  return randomUint32(); // CSPRNG
}

// apps/server/src/rooms/<sala>.test-helper.ts — sala de teste
class TestFixtureRoom extends FixtureRoom {
  protected override createMatchSeed(): number {
    return 42; // seed fixa, idêntica em todas as execuções
  }
}
```

A sala de teste é registrada **apenas no servidor de teste** (`server.define('fixture-test', TestFixtureRoom)`),
com um `roomName` diferente do de produção, de modo que nenhum cliente real alcance a sala de teste.

### 4.2 Por que a seed não pode vir de `options` do matchmaking

- `onCreate` recebe `merge({}, clientOptions, handler.options)` (`MatchMaker.cjs:376`). Em produção,
  `handler.options` é `undefined` — `server.define` só define `handler.options` quando recebe
  `defaultOptions`. Logo, em produção, **`options` é 100% controlado pelo cliente**. Uma seed lida
  dali é escolhida pelo cliente, o que viola a regra 11 (aleatoriedade controlada) e o requisito
  "servidor autoritativo" (regra 9).
- `server.define(nome, Classe, defaultOptions)` faz `handler.options` **sobrescrever** o cliente.
  Portanto registrar a sala de teste com `defaultOptions` fixos **é seguro** contra o cliente. Mas
  isso **não serve para produção**: a seed precisa ser aleatória e **por partida**, não por
  processo; `defaultOptions` é constante para todas as salas criadas por aquele handler.
- `onJoin` também recebe as opções do matchmaking (`Room.cjs:1220-1221`), ou seja, `options` é
  controlado pelo cliente em toda a superfície de entrada.

### 4.3 Por que a costura por método `protected` é superior

| Critério | `options` do matchmaking | `defaultOptions` do `define` | Método `protected` sobrescrevível |
| --- | --- | --- | --- |
| Alcançável pelo cliente | Sim | Não | Não |
| Aleatoriedade por partida | Não (o cliente escolhe) | Não (constante por processo) | Sim |
| Adequado a produção | Não | Não | Sim |
| Teste determinístico | Não | Sim | Sim |
| Reversível | Sim | Sim | Sim (trocar o corpo do método) |

A costura é testável sem rede e sem banco; a seed nunca aparece na borda; e a sala de teste estende a
sala de produção, de modo que o caminho exercitado nos testes é o mesmo caminho de produção, com
uma única substituição.

## 5. Mapeamento de erros

Erros do motor passam ao cliente **sem tradução**, exceto `invalid_setup`, que vira `internal`
(contrato §5). `message` é texto seguro para exibição, sem pilha, sem segredo e sem detalhe interno;
o cliente decide o comportamento pelo `code`.

| Condição (origem) | `code` do protocolo | Quem recebe |
| --- | --- | --- |
| Payload de `create_room`/`join_room`/`reconnect`/`action_intent` falha na validação Zod | `invalid_payload` | Somente o remetente |
| Identidade já informada nesta conexão: segundo `create_room` ou `join_room` na mesma conexão | `invalid_payload` | Somente o remetente |
| Tipo de mensagem desconhecido (sem handler específico) | `invalid_payload` | Somente o remetente |
| `join_room`/`reconnect` com `roomCode` diferente do código da sala | `room_not_found` | Somente o remetente |
| `joinById` com código inexistente (falha no matchmaking, antes do WebSocket) | `room_not_found` | Somente o solicitante (erro HTTP do matchmaking, mapeado na borda do cliente) |
| `reconnect` com `sessionToken` desconhecido ou expirado, ou com o token de **outra** sessão numa conexão já vinculada a uma sessão | `session_invalid` | Somente o remetente |
| `action_intent` de cliente sem sessão de jogo | `session_invalid` | Somente o remetente |
| Não há assento de jogo livre (3º jogador) | `room_full` | Somente o remetente |
| `joinById` com a sala cheia no limite de conexões do Colyseus (falha no matchmaking) | `room_full` | Somente o solicitante (erro HTTP do matchmaking, mapeado na borda do cliente) |
| `action_intent` com `matchId` diferente da partida da sala | `match_not_found` | Somente o remetente |
| `action_intent` com `stateVersion` diferente da versão atual | `stale_state` | Somente o remetente |
| Motor: ação fora do turno | `not_your_turn` | Somente o remetente |
| Motor: carta fora da mão do jogador | `card_not_in_hand` | Somente o remetente |
| Motor: partida encerrada | `game_finished` | Somente o remetente |
| Motor: setup inválido (`invalid_setup`) | `internal` | Somente o remetente |
| Falha inesperada do servidor | `internal` | Somente o remetente |

Duas condições da tabela não são falhas de payload e precisam ser lidas com cuidado:

- **Identidade já informada na conexão.** Um segundo `create_room` ou `join_room` na mesma conexão
  é recusado com `invalid_payload`. A condição é o **estado da conexão** — já existe uma sessão de
  jogo vinculada a ela —, não o conteúdo do payload. O protocolo **não tem um código dedicado**
  para isso, e `invalid_payload` é o código estável mais próximo do conjunto definido no
  contrato §5.
- **`reconnect` com o token de outra sessão.** Uma conexão já vinculada a uma sessão de jogo que
  apresenta o token de outra sessão é recusada com **`session_invalid`**, e não com
  `invalid_payload`: o vínculo existente é preservado, para que duas sessões de jogo nunca
  apontem para a mesma conexão. Numa conexão sem vínculo, apresentar o token é o próprio ato de
  assumir a sessão.

### 5.1 Onde cada `error` é entregue

- **Nenhum `error` é entregue a terceiros.** O `error` vai sempre para a conexão que originou a
  falha, via `client.send('error', ...)`.
- **Nenhum `error` muda estado público.** Rejeitar uma ação não altera `state_public`, `events`,
  `seats` nem `version`. O estado público só muda por `state_public` e `events` (broadcast), e a
  visão privada só muda por `state_private` (direcionada ao dono).
- Erros do **motor** não carregam nada além de `code` e `message`: a mensagem do motor é reescrita
  em texto seguro, e nenhum detalhe do estado interno (mão, baralho, seed) aparece.
- Erros do **matchmaking** (antes do WebSocket) não são mensagens `error`: são falhas HTTP do
  Colyseus (`MatchMakeError`, `sdk/src/Client.ts:444-451`) e chegam ao cliente como falha de
  `sdk.create`/`sdk.joinById`. A borda do cliente os traduz para os mesmos `code` do protocolo, de
  modo que a UI tenha uma única tabela de códigos.

### 5.2 Ordem de conferência no servidor para `action_intent`

1. Sessão de jogo do emissor existe? Não ⇒ `session_invalid`.
2. Envelope válido no Zod? Não ⇒ `invalid_payload`.
3. `matchId` é o da sala? Não ⇒ `match_not_found`.
4. `stateVersion` é a versão atual? Não ⇒ `stale_state`.
5. Partida em andamento? Não ⇒ `game_finished`.
6. Aplicação no motor. Erro ⇒ o `code` do motor, sem tradução (exceto `invalid_setup` ⇒ `internal`).

O turno **nunca** é conferido pelo cliente: o motor decide a partir do estado, e é ele que devolve
`not_your_turn`.

## 6. Validação de entrada

### 6.1 Por que não usar `onMessage(tipo, schema, callback)`

A sobrecarga `onMessage(messageType, validationSchema, callback)` do Colyseus 0.18 valida o payload
com **Standard Schema** no momento do decode e, **quando a validação falha, encerra a conexão**:

- `RoomMessages.cjs:151-158` — o `standardValidate` é chamado dentro de um `try`; a exceção cai no
  `catch`, que chama `client.leave(CloseCode.WITH_ERROR)` e **encerra o WebSocket**.
- `utils/StandardSchema.cjs:27-36` — `standardValidate` lança um `Error` quando o resultado tem
  `issues`.

Isso contradiz o requisito do contrato §5 de que uma falha de validação responda
`error { code: 'invalid_payload' }` **sem derrubar a conexão** (e o requisito não funcional de
"tolerante a falhas").

**Conclusão:** validar **manualmente**, dentro do handler, com `safeParse` do schema Zod de
`packages/protocol`; em caso de falha, responder `error { code: 'invalid_payload' }` e **não** tocar
em `client.leave`/`client.error`. O schema Zod é o mesmo já publicado em `packages/protocol`; ele é
usado como valor de `safeParse`, não como argumento de `onMessage`.

### 6.2 Handler curinga `'*'` e mensagens sem handler

- O handler curinga `'*'` recebe `(client, type, payload)` — a ordem dos argumentos é diferente da
  dos handlers tipados (`RoomMessages.cjs:161-162` e `RoomMessages.cjs:111-114`).
- Com handler curinga registrado, **toda** mensagem cujo tipo não tenha handler específico cai nele
  (`RoomMessages.cjs:161-162`), o que permite responder `error { code: 'invalid_payload' }` sem
  derrubar a conexão.
- **Sem** handler curinga e **sem** handler do tipo, o comportamento difere por ambiente
  (`RoomMessages.cjs:278-291`):
  - **Produção**: o cliente é **desconectado** (`client.state = LEAVING; client.leave(CloseCode.WITH_ERROR)`).
  - **devMode**: o Colyseus responde `client.error(ErrorCode.INVALID_PAYLOAD, ...)` e **mantém** a conexão.

  Por isso o handler curinga `'*'` é obrigatório na sala de produção: sem ele, um cliente que envie
  uma mensagem desconhecida perde a conexão em produção — comportamento diferente do que o contrato
  §5 exige e diferente do comportamento observado em devMode.
- O curinga `'*'` **não** substitui a validação por tipo: ele detecta o tipo desconhecido, mas cada
  handler tipado continua validando o próprio payload com `safeParse`.

## 7. Riscos e mitigações

| # | Risco | Evidência | Mitigação |
| --- | --- | --- | --- |
| a | **`RoomCode` curto é adivinhável.** O código de 6 caracteres tem espaço de busca pequeno, e o `joinById` não tem limite nativo de tentativas | `RoomCode` opaco (contrato §2); `joinById` em `MatchMaker.cjs:229-238` | Alfabeto sem caracteres ambíguos (`0/O`, `1/I/L`) + CSPRNG + **limite de tentativas** por código/IP — limite é **decisão de produto adiada** (§8) |
| b | **Colisão de `RoomCode` conecta o cliente à sala alheia.** Em `recordRoom`, quando `driver.insert` retorna `false` (código já existente), a sala nova é descartada e `handleCreateRoom` devolve o `_listing` da sala **existente** — o cliente que "criou" a sala seria ligado silenciosamente à sala de outro jogador | `MatchMaker.cjs:424-440`; `LocalDriver.cjs:88-95` | Em `onCreate`, verificar se o código já existe (por exemplo via `matchMaker.getRoomById(code)`, `MatchMaker.cjs:451-453`) e, se existir, regerar com CSPRNG — com número limitado de tentativas e falha explícita se esgotar |
| c | **`maxClients` do Colyseus ≠ assentos de jogo.** `hasReachedMaxClients` conta `clients.length + reservedSeats`; o número de assentos de jogo é 2 (`0`/`1`). São limites **distintos** que protegem coisas diferentes | `Room.cjs:486-488`; `Room.cjs:1425-1428`; `MatchMaker.cjs:556-558` | Documentar os dois limites explicitamente: `maxClients` protege o número de **conexões Colyseus** (inclusive reservas pendentes e reconexões); o assento de jogo protege a **regra** (nenhum terceiro jogador senta). Com 2 jogadores conectados, um terceiro `joinById` é barrado no matchmaking; com 1 jogador ausente, a reconexão é aceita e o terceiro jogador recebe `room_full` na mensagem |
| d | **`autoDispose` e limpeza da sala.** Sala vazia que permanece viva ocupa memória; sala que morre cedo encerra a partida | `resetAutoDisposeTimeout` em `Room.cjs:1326-1335`; `#_disposeIfEmpty` em `Room.cjs:1473-1480` | `autoDispose = false` durante a partida; o descarte é **explícito** e cobre dois casos: (a) sala **vazia sem partida iniciada** — não há estado de jogo nem assento de reconexão a preservar — e (b) **partida encerrada** com todos desconectados. A partida **em andamento** com todos desconectados **permanece viva**, na espera da decisão de produto sobre a janela de reconexão (§8, item 1). A limpeza do driver acontece em `#_dispose` (`Room.cjs:1481-1485`), removendo o listing pelo `roomId` |
| e | **Seed influenciada pelo cliente.** `options` do matchmaking é inteiramente do cliente em produção | `MatchMaker.cjs:376`; `Room.cjs:1220-1221` | Seed gerada por CSPRNG dentro da sala, por método `protected` não alcançável pelo cliente (§4) |
| f | **`Math.random` em caminho de produção.** A primeira versão da sala gerava o código de sala com `Math.random` | `apps/server/src/rooms/fixture.ts`; `apps/server/src/rooms/random.ts` | **Mitigado.** `apps/server/src/rooms/random.ts` é a **porta de entrada única** da aleatoriedade do servidor: `cryptoRandomBytes` (CSPRNG da plataforma), `randomRoomCode`, `randomSessionToken` e `randomUint32`. O sorteio do código de sala é **por rejeição** (bytes fora da janela de aceitação são descartados), o que evita o viés de módulo; a fonte de bytes é injetável, mas só o **teste** a substitui, e a sala de teste sobrescreve **apenas** `createMatchSeed`. `Math.random` não aparece em nenhum caminho de produção (regra 11 do `AGENTS.md`) |
| g | **Colyseus derruba a conexão em payload inválido** quando se usa a sobrecarga com schema | `RoomMessages.cjs:151-158`; `utils/StandardSchema.cjs:27-36` | Validação manual com `safeParse` dentro do handler + `error { invalid_payload }` (§6.1) |
| h | **Mensagem sem handler derruba a conexão em produção** | `RoomMessages.cjs:278-291` | Handler curinga `'*'` sempre registrado (§6.2) |
| i | **Erro do matchmaking não é mensagem `error`.** A falha de `joinById` acontece antes do WebSocket e chega como `MatchMakeError` | `sdk/src/Client.ts:444-451`; `MatchMaker.cjs:229-238`; `MatchMaker.cjs:556-558` | A borda do cliente traduz o erro de matchmaking para o mesmo conjunto de `code` do protocolo (§5.1) |

## 8. Decisões adiadas

Nenhuma destas decisões é resolvida aqui. As marcadas como **decisão de produto pendente** dependem do
autor do projeto.

| # | Decisão | Natureza | Comportamento do spike |
| --- | --- | --- | --- |
| 1 | Janela de reconexão, tempo limite de jogador ausente e ação automática | **Decisão de produto pendente** | O spike não impõe prazo: o `sessionToken` vale enquanto a sala viver, e o assento de jogo é preservado na queda |
| 2 | Limite de tentativas por código de sala | **Decisão de produto pendente** | O spike não limita tentativas |
| 3 | Formato e comprimento finais do `RoomCode` (alfabeto) | **Decisão de produto pendente** | O spike usa 6 caracteres de alfabeto sem ambiguidade, gerados por CSPRNG |
| 4 | Listagem de salas públicas via `metadata` | **Decisão de produto pendente** | O spike não lista salas. Observação técnica: o setter `metadata` só aceita escrita enquanto `_internalState === CREATING`, ou seja, dentro de `onCreate` (`Room.cjs:203-208`) |
| 5 | Dono da sala e início manual da partida | **Decisão de produto pendente** | No spike a partida nasce com a sala e começa automaticamente com 2 assentos (contrato §5) |
| 6 | `gameId` real no lugar de `"fixture"` | **Decisão de produto pendente** | O spike usa o jogo-fixture descartável, com `gameId: "fixture"` |
| 7 | Manter o `RoomCode` como `roomId` do Colyseus quando houver salas públicas | **Decisão de produto pendente** | O spike assume `roomCode === roomId`. Ponto de atenção: o `roomId` aparece na URL do matchmaking e no chave do cache do driver; separar os dois exige mapear código→sala e reavaliar a colisão de código (risco b) |
| 8 | Onde e por quanto tempo o `sessionToken` é guardado no cliente | **Decisão de produto pendente** | O spike não define armazenamento; o token é entregue apenas na `join_accepted` |
| 9 | Onde persistir/expira o `sessionToken` no servidor | **Decisão de produto pendente** | O spike guarda em memória, na sala; sem persistência (ADR-001) |

## 9. Verificado no código do Colyseus 0.18

Todos os fatos abaixo foram conferidos no código instalado
(`@colyseus/core@0.18.28`, `@colyseus/sdk@0.18.10`, `colyseus@0.18.12`), sob
`node_modules/.pnpm/`. Um revisor não precisa repetir a pesquisa.

| # | Fato verificado | Arquivo:linha |
| --- | --- | --- |
| 1 | `set roomId` só aceita escrita enquanto `_internalState === CREATING`; fora disso lança `ServerError` ("'roomId' can only be overridden upon room creation.") | `Room.cjs:403-408` |
| 2 | `_internalState = CREATING` é atribuído no construtor da sala | `Room.cjs:166` |
| 3 | `handleCreateRoom` chama `onCreate` **antes** de `_internalState = CREATED` — portanto `onCreate` pode sobrescrever `roomId` | `MatchMaker.cjs:374-386` |
| 4 | `_listing.roomId = room.roomId` (cache do driver recebe o código final) ocorre **depois** de `onCreate` | `MatchMaker.cjs:387` |
| 5 | `createRoomReferences` — que faz `rooms[room.roomId] = room` — é chamado **depois** de `onCreate` | `MatchMaker.cjs:420` e `MatchMaker.cjs:712` |
| 6 | `buildSeatReservation` devolve `roomId: room.roomId` — o código curto — e `sessionId`/`processId` | `MatchMaker.cjs:595-609` (linha 599) |
| 7 | `joinById` resolve a sala por `driver.findOne({ roomId })` e só então reserva assento; código inexistente ⇒ `MATCHMAKE_INVALID_ROOM_ID` | `MatchMaker.cjs:229-238` |
| 8 | `LocalDriver.insert`/`persist` indexam o listing por `room.roomId` e rejeitam duplicidade (`insert` retorna `false`) | `LocalDriver.cjs:88-103` |
| 9 | `onCreate` recebe `merge({}, clientOptions, handler.options)` — `handler.options` sobrescreve o cliente, mas é `undefined` em produção | `MatchMaker.cjs:376` |
| 10 | `onJoin(client, joinOptions, auth)` recebe as opções do matchmaking (controladas pelo cliente) | `Room.cjs:1220-1221` |
| 11 | `hasReachedMaxClients()` = `clients.length + Object.keys(this._reservedSeats).length >= maxClients` | `Room.cjs:486-488` |
| 12 | `_reserveSeat` devolve `false` quando a sala atingiu o máximo ⇒ `SeatReservationError` ("is already full") | `Room.cjs:1425-1428` e `MatchMaker.cjs:556-558` |
| 13 | Mensagem cujo tipo não tem handler: em produção o cliente é **desconectado** (`client.leave(CloseCode.WITH_ERROR)`); em devMode recebe `client.error(INVALID_PAYLOAD)` sem perder a conexão | `RoomMessages.cjs:278-291` (linhas 285-290) |
| 14 | O handler curinga `'*'` recebe `(client, type, payload)` — ordem diferente dos handlers tipados | `RoomMessages.cjs:161-162` e `RoomMessages.cjs:111-114` |
| 15 | `onMessage(tipo, schema, callback)` valida com Standard Schema e, se a validação falhar, **encerra a conexão** (`client.leave(WITH_ERROR)`); `standardValidate` lança em `issues` | `RoomMessages.cjs:151-158` e `utils/StandardSchema.cjs:27-36` |
| 16 | `sdk.create(roomName)` ⇒ `POST /matchmake/create/:roomName`; `sdk.joinById(roomId)` ⇒ `POST /matchmake/joinById/:roomId` (o código vai na **URL**); o corpo é `options` | `sdk/src/Client.ts:227-228`, `sdk/src/Client.ts:273-274` e `sdk/src/Client.ts:428-434` |
| 17 | `consumeSeatReservation` define `room.roomId = response.roomId` e abre o WebSocket em `/{processId}/{roomId}` | `sdk/src/Client.ts:312-329` |
| 18 | `sdk.reconnect` exige `reconnectionToken` no formato `roomId:token` — mecanismo **nativo**, distinto do `sessionToken` do projeto | `sdk/src/Client.ts:297-305` |
| 19 | `allowReconnection(previousClient, seconds)` é o mecanismo nativo de reconexão (indexado por `reconnectionToken`) | `Room.cjs:1274-1325` |
| 20 | `recordRoom` descarta a sala nova e devolve o `_listing` da sala **existente** quando o `driver.insert` falha por colisão de `roomId` | `MatchMaker.cjs:424-440` |
| 21 | `getRoomById(roomId)` ⇒ `driver.findOne({ roomId })` — gancho disponível para detectar colisão de código | `MatchMaker.cjs:451-453` |
| 22 | O setter `metadata` só aceita escrita enquanto `_internalState === CREATING` (isto é, dentro de `onCreate`); a docstring indica `setMatchmaking()` para persistência automática | `Room.cjs:203-208` e `Room.cjs:190-192` |
| 23 | `client.reconnectionToken` é gerado pelo Colyseus em `_onJoin` | `Room.cjs:1132` |
| 24 | `resetAutoDisposeTimeout` e `#_disposeIfEmpty` controlam o descarte automático da sala vazia | `Room.cjs:1326-1335` e `Room.cjs:1473-1480` |
| 25 | `#_dispose` remove o listing do driver por `this._listing.roomId` | `Room.cjs:1481-1485` |
| 26 | Falha de matchmaking chega ao cliente como `MatchMakeError`, com o código Colyseus preservado | `sdk/src/Client.ts:444-451` |

### 9.1 Estado verificado do spike

Enquanto a §9 registra fatos sobre o **Colyseus**, esta subseção registra o estado do **código do
projeto**, conferido em `apps/server/src/rooms/` e nos testes de integração.

**Implementado e coberto por teste automatizado:**

- **Fluxo de criar, entrar e reconectar**: `create_room`, `join_room` e `reconnect` são tratados
  pela sala, e a identidade do jogador chega por **mensagem**, não pelo `options` do matchmaking.
- **Estado autoritativo**: a intenção do cliente é validada e aplicada no servidor; a ação
  inválida é recusada com `error` **só ao remetente** e não altera o estado de nenhum cliente.
- **Isolamento da visão privada por conexão**: `state_private` é enviada **por conexão**, com a
  visão calculada para o dono; a verificação varre o payload estruturado e o JSON bruto de tudo
  que cada conexão recebeu, e nenhum identificador da mão alheia aparece.
- **Códigos de erro do contrato com teste dedicado**: `invalid_payload`, `not_your_turn`,
  `card_not_in_hand`, `stale_state`, `match_not_found` e `session_invalid`.
- **Validação manual com `safeParse`** em cada handler: payload inválido é recusado com
  `invalid_payload` **sem derrubar a conexão**.
- **Descarte da sala**: a sala vazia **sem partida iniciada** é descartada do matchmaking.

**Ainda não coberto:**

- **S4 (reconexão) não tem teste automatizado.** O caminho de reconexão existe no código, mas o
  cenário de queda e retorno — voltar ao mesmo assento com a mesma mão, a sala com 2 jogadores e
  sem assento duplicado — ainda não é verificado. O que existe hoje é o teste do **conflito de
  vínculo**: uma conexão já presa a uma sessão que apresenta o token de outra é recusada com
  `session_invalid`, sem vazar a visão privada alheia.
- **Erros sem teste dedicado**: `room_full`, `session_invalid` por token **desconhecido**,
  `game_finished` e `room_not_found` por código errado.
- **Não existem ainda**: listagem de salas públicas, dono da sala e início manual da partida
  (§8, itens 4 e 5).

**Onde estão os testes:**

- `apps/server/src/rooms/fixture.integration.test.ts` — os testes de integração (S1–S3, o conflito
  de vínculo na reconexão e o ciclo de vida da sala).
- `apps/server/src/rooms/fixture.integration.helper.ts` — o harness: sobe um servidor Colyseus
  real, conecta clientes reais do SDK oficial e acumula **todas** as mensagens recebidas por
  conexão (o "payload bruto" exigido pelo ADR-001).
- A sala de teste é a classe `SeededFixtureRoom`, em `apps/server/src/rooms/fixture.test-helper.ts`:
  estende a sala de produção e sobrescreve **apenas** `createMatchSeed`, devolvendo
  `TEST_MATCH_SEED = 42`. Ela é registrada no servidor de teste com o nome **`fixture-test`**,
  distinto do nome de produção (`fixture`), de modo que nenhum cliente real alcança a sala de
  seed fixa (§4.1).

## 10. Emenda ao ADR-001 (texto pronto para o `documenter`)

> Texto aplicado no ADR-001 em 2026-11-12 (ver `docs/adr/0001-stack.md`, Emenda 1).

```markdown
### Emenda 1 (2026-11-12) — Projeção por jogador sem `StateView` de schema

**Escopo:** altera o critério S3 do spike ("Informação oculta por jogador via `StateView`") e a
mitigação do risco "O `StateView` do Colyseus não filtrar informação oculta como o produto exige".

O spike optou por **mensagens privadas explícitas**, sem usar o `StateView` de schema:

- `state_public` — payload idêntico para todos os clientes da sala (cabeçalho da partida, `seats`
  e visão pública do motor). Entregue por broadcast.
- `state_private` — visão privada calculada por `viewFor` **apenas** para o jogador dono, enviada
  por conexão e nunca reutilizada entre clientes.

Esta escolha é permitida pelo contrato `docs/architecture/0001-fixture-contract.md` §6, que admite
"filtro por cliente no `StateView`, mensagem privada ou combinação". O isolamento por cliente é
assegurado por construção: a mensagem privada é enviada ao `client` correspondente e nunca entra em
broadcast. **O critério de aceite S3 permanece inalterado**: nenhum identificador de carta da mão
alheia pode aparecer no payload recebido por um jogador, verificado por asserção automatizada sobre
o payload bruto de cada conexão.

Mecanismo de salas, mensagens, reconexão e verificação no código do Colyseus 0.18:
`docs/architecture/0002-spike-mecanismo-tempo-real.md`.
```
