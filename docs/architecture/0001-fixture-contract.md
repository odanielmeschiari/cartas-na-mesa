# 0001 — Contrato mínimo: motor de jogo, fixture e rede do spike

- **Status:** aceito para implementação dos passos 2–5
- **Data:** 2026-11-12
- **Fonte:** `AGENTS.md`, `docs/adr/0001-stack.md`, `next_tasks.md` (itens 2–3)
- **Escopo:** contrato do motor e do jogo-fixture descartável do spike; não define regra de jogo real.

## 1. Princípios do contrato

- `packages/core` é domínio puro: não importa Colyseus, React, Zod, rede, relógio ou persistência.
- Determinismo: toda aleatoriedade vem de um `Rng` injetado; proibido `Math.random`, `Date` ou estado global.
- Servidor é a única fonte de verdade: o cliente envia intenções; a ação só existe depois de validada e aplicada no servidor.
- Visão por jogador: estado público idêntico para todos e visão privada calculada sob demanda para um único jogador.
- Identificadores são opacos na borda; nenhum formato de código de sala ou token é fixado aqui.
- O contrato usa `campo: T | null` em payloads (JSON não representa ausência). Nenhum campo é `?:`; com `exactOptionalPropertyTypes`, o servidor nunca constrói chave com valor `undefined`. `avatarId: null` significa "avatar padrão".

## 2. Tipos canônicos

| Tipo | Forma | Observação |
| --- | --- | --- |
| `GameId` | string opaca (`"fixture"` no spike) | seleção de jogo fica fora do payload do spike |
| `RoomCode` | string opaca | formato/alfabeto em aberto |
| `MatchId` | string opaca | gerado pelo servidor por partida |
| `PlayerId` | string opaca | atribuído pelo servidor; nunca aceito do cliente |
| `SeatIndex` | inteiro ≥ 0 | no fixture, `0` ou `1` |
| `CardId` | string opaca | no fixture, `"c1"`…`"c4"` |
| `Nickname` | string 1–24 após `trim` | sem unicidade garantida no spike |
| `AvatarId` | `string \| null` | `null` = avatar padrão |
| `SessionToken` | string opaca | geração/entrega a validar no passo 4 |
| `StateVersion` | inteiro ≥ 0 | começa em 0; +1 por ação aceita; pertence à infraestrutura |

## 3. Interface do motor (`GameDefinition`)

```ts
interface Rng { nextUint32(): number } // injetado; implementação real do shuffle no passo 3

type PlayerSeed = {
  playerId: PlayerId; seatIndex: SeatIndex; nickname: Nickname; avatarId: AvatarId;
};

type EngineAction<A> = { playerId: PlayerId; payload: A }; // playerId vem da sessão, nunca do cliente

type ApplyResult<S, E> =
  | { ok: true; state: S; events: readonly E[] }
  | { ok: false; error: EngineError };

type EngineError = {
  code: "not_your_turn" | "card_not_in_hand" | "game_finished" | "invalid_setup";
  message: string;
};

interface GameDefinition<S, A, P, V, R, E> {
  readonly id: GameId;
  readonly playerCount: { readonly min: number; readonly max: number };
  createInitialState(players: readonly PlayerSeed[], rng: Rng): S;
  legalActions(state: S, playerId: PlayerId): readonly A[];
  applyAction(state: S, action: EngineAction<A>): ApplyResult<S, E>;
  publicView(state: S): P;
  viewFor(state: S, playerId: PlayerId): V;
  resultOf(state: S): R | null;
}
```

- `createInitialState` valida quantidade/assentos e distribui cartas usando somente `rng`. Setup inválido é erro tipado com `code: "invalid_setup"` (a infraestrutura valida antes; é defesa em profundidade, não fluxo esperado).
- `legalActions` devolve `[]` fora do turno, com partida encerrada ou para jogador inexistente. O servidor recalcula; nunca confia na lista enviada pelo cliente.
- `applyAction` valida a ação contra o estado, retorna **novo** estado + eventos, ou erro; nunca muta a entrada. Ação rejeitada não produz estado novo.
- `publicView` não contém nenhuma carta oculta; `viewFor` recebe o jogador solicitante e só pode ser chamado para ele.
- `resultOf` devolve `null` enquanto a partida não termina.
- **Motor:** legalidade, transição, eventos, resultado e projeções. **Infraestrutura:** sala, assentos, presença, `MatchId`, `StateVersion`, token de sessão, validação Zod, autenticação do `playerId`, serialização de aplicações, broadcast e mapeamento de erros. A infraestrutura não conhece baralho, distribuição nem regra alguma.
- `packages/core` não importa `packages/protocol`; identificadores e o payload da ação têm a mesma forma nos dois pacotes, com compatibilidade coberta por typecheck e teste de contrato no passo 3.

## 4. Jogo-fixture (`"fixture"`, descartável)

- Exatamente **2 jogadores** (`playerCount: { min: 2, max: 2 }`), assentos `0` e `1`.
- Baralho mínimo de **4 cartas opacas** (`c1`…`c4`), sem naipe, valor ou face — de propósito, para não se parecer com Poker, Truco, Canastra ou Paciência.
- `createInitialState` embaralha as 4 cartas com o `Rng` e distribui uma por vez, alternando a partir do assento `0`: `deck[0]→0`, `deck[1]→1`, `deck[2]→0`, `deck[3]→1`. Não sobra carta. A ordem da mão é a ordem de distribuição.
- Turno inicial: assento `0`. Ordem de turno: assento ascendente, com retorno ao `0` (equivale a duas rodadas). Passa a vez ao próximo jogador que ainda tenha cartas; se ninguém tiver, a partida termina.
- **Única ação:** `{ type: "play_card"; cardId: CardId }`. Válida somente se a partida está em andamento, é o turno do jogador e `cardId` está na mão dele. Efeito: remove a carta da mão, acrescenta `{ playerId, cardId }` ao fim de `table` e emite eventos.
- Eventos: `{ type: "card_played"; playerId; cardId }`, `{ type: "turn_changed"; playerId }` e, no fim, `{ type: "match_finished"; result }`. Eventos são públicos e nunca contêm carta de mão, baralho restante ou seed.
- **Fim:** quando as duas mãos ficam vazias (4 jogadas). **Resultado:** `{ outcome: "draw" }` — o fixture não ordena cartas nem declara vencedor; inventar um vencedor seria codificar regra de jogo falsa.
- Erros: jogar fora do turno → `not_your_turn`; carta fora da própria mão (inclusive carta do oponente) → `card_not_in_hand`; após o fim → `game_finished`.

## 5. Contrato de rede (schema-ready para Zod)

| Mensagem | Direção | Payload |
| --- | --- | --- |
| `create_room` | C→S | `{ nickname; avatarId }` |
| `join_room` | C→S | `{ roomCode; nickname; avatarId }` |
| `reconnect` | C→S | `{ roomCode; sessionToken }` |
| `action_intent` | C→S | `{ matchId; stateVersion; action }` |
| `join_accepted` | S→C | `{ roomCode; matchId; playerId; seatIndex; sessionToken }` |
| `room_waiting` | S→C | `{ roomCode; seats }` |
| `state_public` | S→C | `{ matchId; roomCode; version; seats; game }` |
| `state_private` | S→C | `{ matchId; version; view }` |
| `events` | S→C | `{ matchId; version; events }` |
| `error` | S→C | `{ code; message }` |

```ts
type ActionPayload = { type: "play_card"; cardId: CardId };

type SeatInfo = { playerId: PlayerId; seatIndex: SeatIndex; nickname: Nickname; avatarId: AvatarId; connected: boolean }; // infra; lista ordenada por seatIndex

type FixturePublicView = {
  gameId: "fixture";
  status: "playing" | "finished";
  currentTurnPlayerId: PlayerId | null; // null quando finished
  handSizes: readonly { playerId: PlayerId; count: number }[]; // ordem de assento
  table: readonly { playerId: PlayerId; cardId: CardId }[];     // ordem de jogada
  result: { outcome: "draw" } | null;
};

type FixturePrivateView = {
  playerId: PlayerId;
  hand: readonly CardId[];
  legalActions: readonly ActionPayload[];
};
```

- **Sem `playerId` no `action_intent`:** o servidor o resolve da sessão e monta `EngineAction`. `matchId` e `stateVersion` rejeitam replay de outra partida (`match_not_found`) e intenção com versão diferente da atual (`stale_state`); o turno é conferido no motor, a partir do estado.
- **Entrada:** `nickname` é obrigatório (todo assento precisa de rótulo acessível); `avatarId` sempre presente, `null` = padrão. O servidor aplica `trim` e revalida os limites.
- **Códigos de erro estáveis:** `invalid_payload`, `room_not_found`, `room_full`, `session_invalid`, `match_not_found`, `stale_state`, `not_your_turn`, `card_not_in_hand`, `game_finished`, `internal`. Erros do motor passam sem tradução, exceto `invalid_setup`, que vira `internal`. `message` é texto seguro para exibição, sem pilha, segredo ou detalhe interno; o cliente decide comportamento pelo `code`.
- **Público:** `seats`, `FixturePublicView`, `version`, `matchId`, `roomCode`, eventos já ocorridos. **Privado:** `FixturePrivateView` e `sessionToken`, somente para o dono. **Nunca sai do servidor:** mão alheia, baralho restante, seed/estado do `Rng`, tokens de outras sessões. A única carta de oponente que trafega é a que já está em `table`.
- Nome do canal e transporte exatos (opções de `join` versus mensagem, reconexão) ficam para o passo 4; os payloads acima não mudam.
- Antes do segundo assento, o servidor envia `room_waiting`; `state_public`/`state_private` só existem com a partida iniciada. No spike, `matchId` nasce com a sala, a partida começa automaticamente com 2 assentos e o estado de jogo é criado nesse momento; dono/início manual ficam pós-spike.

## 6. Mapeamento para `StateView`

- Estado público sincronizado: `state_public` (cabeçalho da partida + `seats` + `FixturePublicView`). Deve ser **idêntico** para todos os clientes da sala.
- Visão privada: `state_private` calculada por `viewFor` apenas para o jogador autenticado; enviada no início, após cada ação aceita e na reconexão; nunca reutilizada entre clientes.
- Reconexão bem-sucedida reemite `join_accepted` com o mesmo `matchId`/`playerId`/`seatIndex`, seguida de estado público e visão privada.
- O mecanismo do Colyseus (filtro por cliente no `StateView`, mensagem privada ou combinação) **deve ser validado no passo 4**; o contrato exige apenas isolamento por cliente e asserção automatizada sobre o payload bruto recebido por cada conexão.
- `sessionToken` nunca entra no estado sincronizado. `connected`/presença pertencem à infraestrutura e não ao motor.

## 7. Critérios S1–S4

| # | Como o contrato atende |
| --- | --- |
| S1 | `create_room`/`join_room` por `roomCode`, `join_accepted` com `matchId`/`playerId`/`seatIndex` distintos e `state_public` com exatamente 2 assentos. |
| S2 | `action_intent` sem `playerId`, validado por Zod, aplicado só no servidor; `stateVersion`/`matchId` e regras do motor rejeitam ação inválida sem novo estado; `error` volta só ao remetente. |
| S3 | A projeção pública só expõe `handSizes` e `table`; `viewFor` entrega a mão apenas ao dono; `state_private` é por conexão; asserção de payload garante ausência de `CardId` alheio. |
| S4 | `reconnect` com `sessionToken` reencontra `playerId`/assento, `state_public` inclui `connected` e a `state_private` é reenviada ao dono; janela e mecanismo a validar no passo 4. |

## 8. Decisões adiadas

- Operação de sala: formato/limite de tentativas do `RoomCode`, janela de reconexão, timeout de ausente e ação automática (passo 4/produto).
- Geração, entrega, armazenamento e expiração do `SessionToken`; API exata de `StateView`/reconexão (passo 4; ver ADR-001).
- Origem do RNG de produção e política de seed; no spike, seed explícita e apenas no servidor.
- Eventos em mensagem separada ou embutidos no estado; correlação de erro por requisição (passo 4).
- Sala real/lobby (dono, início manual, `gameId`) e catálogo/moderação de avatares e apelidos (produto).
