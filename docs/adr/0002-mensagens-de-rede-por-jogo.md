# ADR-002 — Mensagens de rede por jogo

- **Status:** Proposto (aguarda aprovação do autor do projeto)
- **Data:** 2026-11-13
- **Escopo:** como `action_intent`, `state_public`, `state_private` e `events` passam a carregar
  mais de um jogo; não altera o transporte nem o mecanismo de salas (ADR-001, doc 0002)

## Contexto

O contrato de rede do spike (`docs/architecture/0001-fixture-contract.md` §5) fixa o payload de
jogo no fixture: `action_intent.action` usa `actionPayloadSchema`, `state_public.game` usa
`fixturePublicViewSchema`, `state_private.view` usa `fixturePrivateViewSchema` e `events` usa
`gameEventSchema`. Para o Copas, `packages/protocol/src/hearts.ts` já define os schemas
equivalentes, mas nada os liga às mensagens. A regra fundamental 12 proíbe que a infraestrutura de
salas conheça jogo específico.

## Decisão proposta

1. Os campos de jogo das mensagens (`action`, `game`, `view`, `events`) passam a ser a **união**
   (`z.union`) dos schemas de todos os jogos registrados. Não dá para usar `z.discriminatedUnion`
   sobre jogos diferentes: o Zod recusa o mesmo valor de discriminante em duas opções, e
   `play_card` e `card_played` existem no fixture e no Copas. O envelope (`matchId`, `stateVersion`,
   `version`, `seats`) não muda.
2. Cada sala recebe do seu jogo um **adaptador** com o `actionSchema`, os schemas de visão e de
   evento. Depois do envelope, a sala **revalida** a ação com o `actionSchema` do próprio jogo:
   uma ação de outro jogo falha com `invalid_payload`, mesmo que passe pela união.
3. O `play_card` do fixture e o do Copas têm o mesmo formato (`{ type, cardId }`), então a união
   os aceita igualmente; a revalidação por sala é o que impede o uso cruzado.
4. `SeatInfo` ganha o campo `kind: 'human' | 'bot'`, para a mesa mostrar quem é bot. É mudança de
   contrato e entra neste ADR junto com o item 1.
5. Nenhum código de erro novo. Jogada ilegal continua saindo do motor como `invalid_setup`, que o
   servidor mapeia para `internal` (contrato §5); se o cliente precisar distinguir "jogada
   ilegal" de erro interno, um código `illegal_action` entra em ADR próprio.

## Estado da implementação

- `SeatInfo.kind` (item 4): feito em `packages/protocol/src/views.ts`.
- Itens 1–3: `packages/protocol/src/game-messages.ts` traz os schemas do Copas e as uniões
  `anyGame*MessageSchema`. Os schemas sem prefixo em `server-messages.ts` e `client-messages.ts`
  **continuam sendo os do fixture**, de propósito: o cliente do spike e os testes de integração
  dependem dos tipos do fixture, e trocar esses nomes por uniões alargaria os tipos de todos eles.
  Cada sala usa o schema do próprio jogo (`GameRoomAdapter.messages`) e a borda genérica usa a união.
- Adaptadores: `apps/server/src/rooms/game-room-adapter.ts` (`fixtureAdapter`, `heartsAdapter`).

## Alternativas consideradas

- **Um schema de mensagem por jogo** (`action_intent_hearts`, ...): multiplica tipos de mensagem
  e obriga o cliente a escolher o nome pelo jogo; descartada.
- **`action: z.unknown()` no envelope**: perde a validação na borda e move tudo para a sala;
  descartada pela regra 15 (validar na borda **e** no servidor).

## Consequências

- Mudança em `packages/protocol` e nos testes de contrato; o fixture continua válido.
- Adicionar um jogo passa a exigir registrá-lo na união e fornecer o adaptador, sem tocar na lógica
  de salas.
- O limite do `avatarId` (pendência da auditoria) é outro assunto e segue em passo próprio.
