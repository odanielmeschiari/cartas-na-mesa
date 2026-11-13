# 0003 — Sala do Copas: mesa de 4, bots e ciclo de mãos

- **Status:** Proposto (aguarda confirmação das decisões de produto da seção 8)
- **Data:** 2026-11-13
- **Depende de:** `docs/rules/copas.md`, `packages/core/src/hearts-game.ts`,
  `packages/core/src/hearts-bot.ts`, `packages/protocol/src/hearts.ts`, ADR-002

## 1. Objetivo

Definir como o servidor hospeda uma partida de Copas com 1 a 4 humanos e bots nos assentos vagos,
sem mudar o mecanismo de salas do spike (doc 0002): código de sala, identidade por mensagem,
`sessionToken`, reconexão e erro só ao remetente continuam valendo.

## 2. Sala genérica, jogo por adaptador

A sala do spike (`apps/server/src/rooms/fixture.ts`) conhece o `fixtureGame`. Para respeitar a
regra 12, ela é generalizada **antes** de receber o Copas:

```ts
interface GameRoomAdapter<S, A, P, V, R, E> {
  readonly game: GameDefinition<S, A, P, V, R, E>;
  readonly actionSchema: ZodType<A>; // revalida a ação depois do envelope (ADR-002)
  readonly fillWithBots: boolean; // o jogo aceita bots nos assentos vagos
  chooseBotAction?(own: V, table: P): A | null; // só a visão do próprio assento
}
```

`FixtureRoom` e `HeartsRoom` passam a ser o mesmo código com adaptadores diferentes. A
generalização é um passo próprio, com os testes S1–S4 do fixture como rede de segurança.

## 3. Assentos e bots

- Mesa **fixa de 4** (`playerCount: { min: 4, max: 4 }`). Humanos ocupam os assentos na ordem de
  chegada; ao iniciar, cada assento vago recebe um bot.
- Bot é um assento **sem sessão**: sem `sessionToken`, sem conexão, `playerId` sintético
  (`bot-1`, `bot-2`, ...) e apelido fixo. Aparece em `seats` com `kind: 'bot'` (ADR-002) e
  `connected: true`.
- Contra bots: 1 humano + 3 bots, partida iniciada na hora. Online: o dono da sala inicia quando
  quiser; vagas restantes viram bots.
- Dificuldade: só o nível fácil (`chooseEasyAction`). O adaptador recebe a função, então os níveis
  médio e difícil entram sem tocar na sala.

## 4. Quem age e quando

Toda ação, de humano, bot ou automática, passa pelo **mesmo caminho**: conferência do
`action_intent` (doc 0002 §5.2), `applyAction`, incremento de `version`, publicação do estado
público, do privado de cada humano e dos eventos.

- **Bots:** depois de cada mudança de estado, a sala agenda, no `clock` do Colyseus, a jogada do
  bot que tem ação legal. O atraso é injetável (costura de teste, como `identityTimeoutMs`) e, em
  produção, curto o bastante para a mesa ficar legível. Na fase de passe os bots confirmam sem
  esperar os humanos.
- **O bot só vê o que um humano veria:** `viewFor(state, botId)` e `publicView(state)`. Ele nunca
  recebe o estado completo.
- **Humano ausente:** vencido o tempo limite do turno ou do passe, a sala joga por ele com o
  mesmo `chooseEasyAction`. Valores do tempo limite: seção 8.
- **Pausa sem humanos conectados:** com todos os humanos desconectados, os bots **param** de jogar
  (sem partida correndo sozinha). A partida volta a andar quando um humano reconecta. Até quando a
  sala espera é a decisão de produto nº 1 do doc 0002 §8.

## 5. Fim de mão e aleatoriedade

- `applyAction` não recebe `Rng`; ao fim da mão o estado fica em `hand_over`. Depois de uma pausa
  curta para os jogadores verem a pontuação, a sala chama `startNextHand(state, rng)`, incrementa
  `version` e publica. **Implementado** como `GameRoomAdapter.advance` (`isPending` + `apply`): a
  sala genérica agenda o avanço no `clock` depois de cada ação, com a pausa em `advancePauseMs()`
  (5 s; o teste a encurta). A mudança de mão sai só como novo `state_public`, sem evento.
- **`Rng` de produção:** um adaptador fino sobre `randomUint32` (`apps/server/src/rooms/random.ts`),
  isto é, CSPRNG direto, **sem seed de 32 bits**. Isso evita a pendência A3 para o Copas: a mão
  oculta nunca depende de um PRNG de seed pequena. **Implementado** como `createCryptoRng` em
  `apps/server/src/rooms/random.ts`.
- **Teste:** a sala expõe uma costura `protected createRng(): Rng` que o teste sobrescreve com
  `createSeededRng`; só ela muda, como em `createMatchSeed` (doc 0002 §4).
- Na distribuição inicial, a sala também usa `createRng()`; a partida não guarda seed.

## 6. Informação oculta

- `state_public` é idêntico para todos; `handSizes` e `passConfirmed` mostram **quantas** cartas e
  **quem** já confirmou o passe, nunca quais.
- `state_private` leva a mão e a `passSelection` só do dono. As cartas recebidas no passe só
  aparecem na mão de quem as recebeu, depois da troca.
- Os eventos do passe (`pass_confirmed`, `passing_completed`) não carregam cartas.
- O teste S3 do Copas confere o **payload bruto** de cada conexão: nenhum identificador de carta
  de mão alheia, nem durante o passe, nem de bots.

## 7. Passos atômicos seguintes

| # | Passo | Agente | Pronto quando |
| --- | --- | --- | --- |
| 1 | Aprovar ADR-002 e as decisões da seção 8 | usuário | Decisões registradas |
| 2 | Contrato: união (`z.union`) por jogo e `SeatInfo.kind` em `packages/protocol` (**feito**: `SeatInfo.kind` e `game-messages.ts`; os schemas do fixture mantêm o nome) | `implementer` + `tester` | Testes de contrato do fixture e do Copas passam |
| 3 | Generalizar `FixtureRoom` em sala por adaptador, sem mudar comportamento (**feito**: `GameRoom` genérica em `game-room.ts`; `FixtureRoom` é uma subclasse fina com `createRng` por seed) | `implementer` + `tester` | S1–S4 e regressões do fixture iguais |
| 4 | `HeartsRoom`: mesa de 4, início, ação humana e `createRng` (**feito**: `apps/server/src/rooms/hearts.ts`, registrada como `hearts`; testes em `hearts.integration.test.ts`) | `implementer` + `tester` | Partida só com humanos, com S3 por payload bruto |
| 5 | Bots nos assentos vagos e agendamento da jogada | `implementer` + `tester` | Partida completa com 1 humano e 3 bots |
| 6 | Tempo limite e ação automática; pausa sem humanos | `implementer` + `tester` | Ausência não trava a partida |
| 7 | Gate: `reviewer` + `security` sobre a sala do Copas | `reviewer`, `security` | Zero achados bloqueantes |

## 8. Decisões de produto a confirmar

| # | Decisão | Padrão proposto |
| --- | --- | --- |
| 1 | Tempo limite de jogada e de passe de um humano | 30 s por jogada, 60 s para o passe |
| 2 | Pausa entre o fim da mão e a próxima | 5 s |
| 3 | Atraso do bot entre jogadas | 0,6 a 1,2 s |
| 4 | Quem inicia online | Dono da sala; vagas viram bots |
| 5 | Salas de Copas públicas na listagem | Fora desta etapa (depende da A6) |
| 6 | Mostrar que o assento é bot | Sim, `kind: 'bot'` e rótulo visível |

## 9. Riscos

- **Corrida entre bot e humano:** a jogada agendada pode chegar depois de o turno mudar. Ela
  passa pelo `stateVersion` e pelo motor, então vira `not_your_turn`/`stale_state` e é descartada.
- **Bot em sala sem humanos:** coberto pela pausa da seção 4; sem ela, a sala jogaria sozinha até
  o fim e ficaria viva para sempre.
- **Vazamento pelo bot:** o adaptador recebe só visões, então uma função de bot não tem como ler
  mãos alheias; o teste de payload bruto cobre o resto.
