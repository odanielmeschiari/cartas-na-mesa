# Próximas tarefas — Cartas na Mesa

> **Handoff para nova sessão.** Antes de qualquer ação: ler `AGENTS.md` integralmente e
> `docs/adr/0001-stack.md`. A stack está decidida; não reabrir sem pedido do usuário.

**Estado em 2026-11-12:** passos 1–3 concluídos (scaffold do monorepo, protocolo Zod e core
fixture) e **passo 4 (spike do servidor) implementado**. A sala segue o contrato de rede de
`docs/architecture/0001-fixture-contract.md` e o mecanismo de
`docs/architecture/0002-spike-mecanismo-tempo-real.md`: o código de sala **é** o `roomId` do
Colyseus, a identidade do jogador chega por **mensagem** (`create_room`/`join_room`/`reconnect`), a
seed da partida é gerada **no servidor**, a validação é **manual** com `safeParse` — sem derrubar a
conexão — e todo `error` é entregue **só ao remetente**. A aleatoriedade de produção passa por
`apps/server/src/rooms/random.ts`, porta de entrada única baseada em CSPRNG: **não há
`Math.random` em nenhum caminho de produção**. Os testes de integração **S1–S4 estão automatizados**,
com servidor Colyseus real e clientes reais do SDK oficial: o **S4 (reconexão)** tem **teste
automatizado** e os **quatro códigos de erro** `room_full`, `session_invalid` (token desconhecido),
`game_finished` e `room_not_found` (código errado) têm **teste dedicado**. A revisão independente
**foi feita** e seus dois achados bloqueantes foram corrigidos (vínculo de sessão na reconexão e
descarte da sala vazia sem partida). A **auditoria de segurança também foi executada** (2026-11-12):
**nenhum achado crítico**; os **dois achados alto** — _vazamento de sala vazia sem identidade_ e
_conexão sem identidade segurando uma vaga de conexão_ — foram **corrigidos**, cada um com **teste
de regressão**. Restaram achados de severidade menor, **pendentes**: **A3** (seed de 32 bits em PRNG
não criptográfico), **A4** (sala de teste com seed fixa dentro de `src/`), **A5** (dependência Git
`uWebSockets.js` na árvore sem uso), **A6** (`roomCode` no metadata público), **A8** (mensagem de
erro do motor passa crua) e o **limite de tamanho do `avatarId`** — detalhados em
[Pendências da auditoria de segurança](#pendências-da-auditoria-de-segurança). **Pendentes:** o
hardening das pendências da auditoria, o spike do cliente e a aprovação do gate. `pnpm typecheck`,
`pnpm lint`, `pnpm test` (8 arquivos, 121 testes) e `pnpm format:check` passam. Houve **commit**,
mas **o push desta rodada ainda não ocorreu**: `git status -sb` mostra
`main...origin/main [à frente 2]`, com o HEAD local em `bdb96f3`
(`add-testes-dos-codigos-de-erro-do-contrato`) e o HEAD de `origin/main` em `346fedf`
(`git log --oneline origin/main -3` → `346fedf registra-auditoria-de-seguranca-do-spike`,
`77169fd endurece-ciclo-de-vida-e-vinculo-de-sessao-da-sala`,
`8733643 atualiza-documentacao-do-spike`). A branch `main` publicada **não** contém as rodadas de
teste do S4 e dos códigos de erro.

**Instalação:** o pnpm 12 lê as opções do projeto de `pnpm-workspace.yaml` — o `.npmrc` só é lido
para auth, registry, TLS, proxy e endereço local. A dependência Git `uWebSockets.js`, puxada pelo
Colyseus, exige `blockExoticSubdeps: false`, que agora vive em `pnpm-workspace.yaml`; a mesma
configuração tem `allowBuilds.msgpackr-extract: true` para o build nativo. O
`pnpm install --frozen-lockfile` **foi executado com sucesso** e o `pnpm-lock.yaml` está commitado.
Não deve existir nenhum `package-lock.json` no repositório (npm package-lock); hoje não há nenhum.

A tentativa de testes com subagents foi bloqueada por quota do provider/modelo; a revisão
independiente foi feita depois, por outra via. A **auditoria de segurança foi executada em
2026-11-12**: nenhum achado crítico; os dois achados de
alto (vazamento de sala vazia sem identidade; conexão sem identidade segurando uma vaga de
conexão) foram **corrigidos** e
cobertos por teste de regressão; os achados de severidade menor ficaram **pendentes** e estão
registrados em
[Pendências da auditoria de segurança](#pendências-da-auditoria-de-segurança).

## Como executar

- Cada item abaixo é **um passo atômico**: um brief, um responsável, um critério de pronto.
- Se a tarefa crescer, quebrar antes de começar.
- Nenhum scaffold, dependência ou comando destrutivo sem autorização explícita.
- Gate obrigatório ao fim de cada bloco: `tester` + `reviewer` + `security` quando aplicável.
- Decisão de produto em aberto não se resolve por suposição: perguntar ao usuário.

## P0 — Validar a fundação (bloqueia todo o resto)

### 1. Scaffold do monorepo

**Status: concluído.** Scaffold do monorepo criado. `pnpm typecheck`, `pnpm lint`, `pnpm test`
(8 arquivos, 121 testes) e `pnpm format:check` passaram mais recentemente. A instalação
reproduzível com lockfile foi validada com `pnpm install --frozen-lockfile` — executado com sucesso,
com o `pnpm-lock.yaml` commitado, conforme o resumo do estado.

### 2. Contratos do fixture

**Status: concluído.** Protocol Zod do fixture definido, conforme
`docs/architecture/0001-fixture-contract.md`.

### 3. Motor mínimo e determinístico

**Status: concluído.** Core fixture determinístico implementado e coberto pelos testes recentes
indicados no resumo do estado.

### 4. Spike do servidor Colyseus

**Status: implementado.** A sala segue o contrato de rede e o mecanismo documentados em
`docs/architecture/0001-fixture-contract.md` e
`docs/architecture/0002-spike-mecanismo-tempo-real.md`:

- o código de sala curto, gerado por CSPRNG, **é** o `roomId` do Colyseus (definido em `onCreate`);
- a identidade do jogador chega por **mensagem** (`create_room`, `join_room`, `reconnect`), não
  pelo `options` do matchmaking — que, em produção, é inteiramente controlado pelo cliente;
- a seed da partida é gerada **no servidor**, por um método `protected createMatchSeed()`; o teste
  sobrescreve **apenas** esse método (`SeededFixtureRoom`, `TEST_MATCH_SEED = 42`, sala registrada
  como `fixture-test`, distinta do nome de produção);
- validação **manual** com `safeParse` do schema Zod em cada handler: payload inválido vira
  `error { code: 'invalid_payload' }` **sem derrubar a conexão**, e há handler curinga para tipo
  de mensagem desconhecido;
- todo `error` é entregue **só ao remetente**; `state_public` é idêntico para todos os jogadores e
  `state_private` vai só para o dono, por conexão;
- aleatoriedade somente por `apps/server/src/rooms/random.ts` (CSPRNG, com sorteio por rejeição no
  código de sala): **sem `Math.random`** em nenhum caminho de produção;
- **prazo de identidade**: uma conexão que não se identifica em 30 s (`IDENTITY_TIMEOUT_MS`) é
  encerrada pelo servidor (`client.leave(4000, 'identity_timeout')`), de modo que ela não segura uma
  vaga de conexão do Colyseus nem barra o jogador legítimo no matchmaking; a conexão que já se
  identificou não é afetada pelo prazo;
- descarte explícito da sala, executado em **todo** `onLeave` (`disposeIfFinished()`): sala vazia —
  **com ou sem partida iniciada** e **com ou sem identidade informada** — e partida encerrada com
  todos desconectados; partida **em andamento** com todos desconectados permanece viva, na espera da
  decisão de produto sobre a janela de reconexão;
- testes de integração **S1–S4 automatizados**, com servidor Colyseus real e clientes reais do
  SDK oficial (`apps/server/src/rooms/fixture.integration.test.ts`), mais os testes de regressão do
  ciclo de vida da sala e do prazo de identidade. A suíte tem **8 arquivos e 121 testes**;
- **S4 (reconexão) automatizado**: a queda da conexão é vista pelo outro jogador como assento
  ausente (`connected: false`) com o assento preservado; a reconexão pelo `roomCode` +
  `sessionToken` devolve o mesmo `playerId`, `seatIndex` e `sessionToken`, com a mesma mão e o
  mesmo estado de turno; a sala continua com 2 jogadores e sem assento duplicado, o outro jogador
  volta a ver o assento como presente e a partida continua jogável depois da reconexão;
- **códigos de erro do contrato com teste dedicado**: `room_not_found`, `session_invalid` (token
  desconhecido), `game_finished`, `invalid_payload` (tipo de mensagem desconhecido) e `room_full`.

**Dois defeitos encontrados na revisão e corrigidos**, cada um com teste de regressão:

1. **Vínculo de sessão na reconexão:** um `reconnect` que apresentasse o token de outra sessão
   vinculava as duas sessões de jogo à mesma conexão. Isso podia entregar **duas visões privadas**
   — inclusive a mão alheia — a um mesmo cliente, e deixar um assento marcado como conectado para
   sempre. Corrigido com recusa `session_invalid`, preservando o vínculo existente.
2. **Sala vazia sem partida nunca descartada:** com `autoDispose = false`, uma sala sem partida e
   sem ninguém dentro permanecia viva no matchmaking. Corrigido com descarte explícito.

**A auditoria de segurança (2026-11-12)** confirmou essas correções com teste de regressão e
apontou **dois achados de alto**, ambos corrigidos: o _vazamento de sala vazia sem identidade_ (a
sala sem identidade permanecia viva no matchmaking) e a _conexão sem identidade segurando uma
vaga de conexão_ (corrigida pelo prazo de identidade). Os achados de severidade menor ficaram
**pendentes** — ver
[Pendências da auditoria de segurança](#pendências-da-auditoria-de-segurança).

**Ainda não coberto:** não existem ainda listagem de salas públicas, dono da sala e início manual
da partida (§8, itens 4 e 5 do doc 0002). As pendências de hardening da auditoria de segurança (A3,
A4, A5, A6, A8 e o limite de tamanho do `avatarId`) seguem abertas.

**Próximo passo atômico:** item 6 do gate (hardening das pendências da auditoria e spike do
cliente).

### 5. Spike do cliente mínimo

**Status: pronto para iniciar.** A pré-condição desta tarefa — servidor implementado e critérios
S1–S4 verificados — **está satisfeita**. Falta a validação do S4 **ponta a ponta** no navegador
(item 6).
**Agente:** `implementer` (layout mínimo com `designer` se necessário) · **Depende:** item 4
**Pronto quando:** duas abas completam S1–S4 do ADR.

### 6. Gate do spike

**Status: em andamento.** A **revisão independente foi concluída** e os dois achados bloqueantes
(vínculo de sessão na reconexão; descarte da sala vazia sem partida) foram **corrigidos**, com
teste de regressão. A **auditoria de segurança também foi concluída** (2026-11-12): nenhum achado
crítico; os dois achados de alto (vazamento de sala vazia sem identidade; conexão sem identidade
segurando uma vaga de conexão) foram **corrigidos**, com teste de regressão; os achados de
severidade menor ficaram **pendentes** (ver
[Pendências da auditoria de segurança](#pendências-da-auditoria-de-segurança)). **S1–S4 têm teste
automatizado**: o **S4 (reconexão)** foi coberto e os **quatro códigos de erro** `room_full`,
`session_invalid` (token desconhecido), `game_finished` e `room_not_found` (código errado) têm
**teste dedicado**. O gate **ainda não está aprovado**: falta o hardening, o spike do cliente e a
execução final.
**Próximas ações, nesta ordem, cada uma como passo atômico:**

1. Hardening: resolver as pendências da auditoria de segurança (A3, A4, A5, A6, A8 e o limite de
   tamanho do `avatarId`), cada uma no momento indicado na tabela abaixo.
2. Spike do cliente mínimo e S4 ponta a ponta (duas abas completam S1–S4 do ADR).
3. Execução final de typecheck, lint, test, build e format.
4. Aprovação do gate, sem achados bloqueantes.

**Agentes:** `tester`, `reviewer`, `security` · **Depende:** item 5
**Pronto quando:** S1–S4 passam automatizados, zero achados bloqueantes e o ADR é atualizado se
algo falhar. **Se o spike falhar, reavaliar Colyseus antes de qualquer regra de jogo.**

### Pendências da auditoria de segurança

Achados de severidade menor deixados pela auditoria de segurança do spike (2026-11-12). **Nenhum
deles está corrigido.** O detalhamento completo, com evidência no código, está em
`docs/architecture/0002-spike-mecanismo-tempo-real.md` §7 (riscos) e §8 (decisões adiadas).

| #          | Sev.  | O que é                                                                                                                                                                                                        | Quando resolver                                          |
| ---------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A3         | MÉDIO | Seed da partida com 32 bits e PRNG `mulberry32` não criptográfico. Irrelevante no fixture (4 cartas), mas o padrão será copiado para os jogos reais, onde a mão oculta é o ativo protegido                     | Antes do primeiro jogo real                              |
| A4         | MÉDIO | Sala de teste com seed fixa mora em `apps/server/src/` (diretório de produção). Hoje inalcançável em produção, mas é armadilha latente                                                                         | No próximo passo de hardening                            |
| A5         | MÉDIO | `uWebSockets.js` (dependência git, com binários nativos) entra na árvore sem ser usada; o servidor usa `@colyseus/ws-transport` via o pacote-umbrela `colyseus`, que também traz monitor, playground e redis-* | No próximo passo de hardening (migração das importações) |
| A6         | MÉDIO | `metadata` público da sala contém o `roomCode`, que é a credencial de acesso. Sem impacto hoje (não há listagem)                                                                                               | Antes de implementar a listagem de salas públicas        |
| A8         | BAIXO | Mensagem de erro do motor passa crua ao cliente; hoje são literais fixos, mas um motor futuro poderia vazar carta                                                                                              | No próximo passo de hardening (convenção/lint)           |
| `avatarId` | BAIXO | `avatarId` sem limite de tamanho no protocolo (`z.string().nullable()`)                                                                                                                                        | Em passo próprio, com ADR (mudança de contrato)          |

## P1 — Primeira mesa jogável

### 7. Decidir o primeiro jogo

**Resumo:** escolher o jogo que valida a mesa. Recomendação: **Paciência (Klondike)**, por ser solo,
sem informação oculta nem turnos de rede complexos, e já exercitar cartas, layout e tutorial.
**Agente:** decisão do usuário; `architect` registra · **Depende:** item 6
**Pronto quando:** decisão registrada no `AGENTS.md` ou em ADR.

### 8. Salas e lobby reais

**Resumo:** criar sala com código não adivinhável, entrar por código, listar salas públicas,
assentos, dono inicia a partida, sair sem quebrar a sala.
**Agente:** `architect` (contrato) + `implementer` · **Depende:** item 6
**Pronto quando:** fluxo completo com testes de integração e limite de tentativas por código.

### 9. Identidade anônima e reconexão robusta

**Resumo:** apelido + avatar lembrados localmente, token de sessão, janela de reconexão, jogador
ausente com tempo limite/ação automática. Sem conta e sem dado pessoal.
**Agente:** `implementer` + `security` · **Depende:** item 8
**Pronto quando:** queda e retorno preservam assento; ausência expira sem travar a partida.

### 10. Paciência — regras

**Resumo:** Klondike em `packages/core`: baralho, colunas, células livres, fundações, reciclagem do
descarte, vitória e movimentos válidos.
**Agente:** `implementer` + `tester` · **Depende:** item 7
**Pronto quando:** regras determinísticas com seed e cobertura dos casos de borda.

### 11. Paciência — mesa e interação

**Resumo:** tabuleiro em madeira conforme referência, 8 colunas, 4 células livres, 4 fundações,
arrastar/clicar, animações curtas e acessibilidade.
**Agente:** `designer` + `implementer` · **Depende:** item 10
**Pronto quando:** jogável por mouse e teclado, responsivo e com `prefers-reduced-motion`.

### 12. Tutorial de Paciência

**Resumo:** tutorial guiado por passos sobre o mesmo motor, com destaque no elemento e instrução
central; primeiro acesso oferece o tutorial.
**Agente:** `designer` + `implementer` · **Depende:** item 11
**Pronto quando:** um usuário novo conclui a primeira partida guiada sem instrução externa.

### 13. Personalização

**Resumo:** avatares, fundos (feltro, madeira, wallpapers) e faces/versos de carta, salvos
localmente; pipeline de assets com origem e licença registradas.
**Agente:** `designer` + `implementer` · **Depende:** item 11 e assets enviados pelo usuário
**Pronto quando:** troca aplica na mesa e persiste após recarregar.

### 14. Base de bots

**Resumo:** bots no servidor usando apenas a visão do próprio jogador; nível fácil por heurística e
espaço para dificuldade maior.
**Agente:** `implementer` + `tester` · **Depende:** item 10
**Pronto quando:** bot conclui partida de Paciência sem acessar estado oculto.

## P2 — Mais jogos

### 15. Truco

**Resumo:** regras, times, valor de mão, pedidos de truco, pontuação, bot e tutorial. Primeiro jogo
a validar informação oculta e turnos em grupo.
**Agente:** `architect` + `implementer` + `tester` · **Depende:** variante definida pelo usuário
**Pronto quando:** partida completa contra bots e entre dois humanos.

### 15a. Copas (variante tradicional)

**Resumo:** Copas para 4 jogadores, com bots ocupando assentos vagos e online por código de sala.
Regras em `docs/rules/copas.md`; regras puras (cartas, jogadas legais, vazas, pontuação, fim de
partida) já em `packages/core/src/hearts.ts`, com testes. Falta, **cada um como passo atômico**:

1. Confirmar com o usuário as "Decisões a confirmar" de `docs/rules/copas.md`.
2. ~~Motor `GameDefinition` do Copas~~ — **feito** em `packages/core/src/hearts-game.ts` (passe oculto,
   jogo, fim de mão e de partida). A mão seguinte é distribuída por `startNextHand(state, rng)`,
   chamada por quem hospeda a partida, porque `applyAction` não recebe `Rng`; o servidor deve
   chamá-la com o CSPRNG quando a fase for `hand_over`. O motor reaproveita os códigos de erro
   existentes (jogada ilegal vira `invalid_setup`, como na Paciência); um código próprio pede ADR.
3. ~~Contratos em `packages/protocol`~~ — **feito** em `packages/protocol/src/hearts.ts` (ações
   `pass_cards`/`play_card`, visões pública e privada, eventos e resultado), validado contra as
   saídas reais do motor numa partida completa. **Pendente:** `action_intent` ainda usa o schema do
   fixture; trocar por um schema por jogo muda o contrato de rede e pede ADR.
4. ~~Bot fácil~~ — **feito** em `packages/core/src/hearts-bot.ts` (`chooseEasyAction`): usa só a
   visão privada do próprio assento e a visão pública; passa a dama de espadas e as cartas mais
   perigosas, cobre por baixo e descarta pontos quando está sem o naipe. Níveis médio e difícil
   ficam para depois.
5. Sala no servidor: desenho em `docs/architecture/0003-sala-copas.md` e `docs/adr/0002-mensagens-de-rede-por-jogo.md`
   (ambos **propostos**, aguardando as decisões de produto da seção 8 do doc 0003). Passos
   atômicos na seção 7 do doc.
6. Mesa e interação no web (mobile-first) e, depois, tutorial.

**Agente:** `architect` (passos 2–3) + `implementer` + `tester` · **Depende:** item 6 (gate do spike)
e decisão do usuário
**Pronto quando:** partida completa contra 3 bots e online entre humanos, sem vazar mãos nem as
cartas do passe.

### 16. Canastra

**Resumo:** melds, sequências/trincas, compra do lixo, pontuação e variante definida.
**Agente:** `architect` + `implementer` + `tester` · **Depende:** item 15 e variante definida
**Pronto quando:** partida completa com regras e pontuação cobertas.

### 17. Poker

**Resumo:** última prioridade por complexidade: apostas, all-in, side pots, showdown e informação
oculta. Apenas fichas fictícias.
**Agente:** `architect` + `implementer` + `tester` + `security` · **Depende:** variante definida
**Pronto quando:** mesa completa sem vazamento de cartas e com apostas validadas no servidor.

## P3 — Operação e sustentação

### 18. CI, observabilidade e deploy

**Resumo:** pipeline com typecheck, lint, testes e E2E; logs sem dados sensíveis; container do
servidor + cliente estático.
**Agente:** `implementer` + `security` · **Depende:** P1 estável
**Pronto quando:** pipeline bloqueia merge quebrado e deploy sobe a partir do container.

### 19. Documentação contínua

**Resumo:** README com como rodar/testar, regras de cada jogo em `docs/rules/`, índice de ADRs e
guia de contribuição.
**Agente:** `documenter` · **Depende:** cada funcionalidade entregue
**Pronto quando:** docs refletem o código verificado, sem suposição.

### 20. Auditoria final de acessibilidade e performance

**Resumo:** revisão de teclado, leitor de tela, contraste, daltonismo, movimento reduzido, além de
medição de latência percebida e tempo de entrada em sala.
**Agente:** `designer` + `tester` + `security` · **Depende:** P1 e P2
**Pronto quando:** checklist aprovado e gargalos medidos.

## Decisões do usuário (não bloqueiam o P0)

- **Primeiro jogo:** Paciência (recomendado) ou Truco.
- **Truco:** Paulista, Mineiro ou Gaúcho; 2 ou 4 jogadores.
- **Canastra:** variante e regra de pontuação.
- **Poker:** Texas Hold'em? Profundidade de apostas no MVP.
- **Salas públicas:** chat, emotes e moderação.
- **Cliente:** apenas web responsivo ou PWA instalável.
- **Deploy:** alvo (Fly.io, Railway, Render, VPS) e registry de container.
- **Persistência:** critério objetivo para introduzir Postgres/Redis.

## Critério para encerrar o P0

S1–S4 do ADR-001 passando de forma automatizada, zero achados bloqueantes de revisão/segurança e
nenhuma regra de jogo escrita antes disso. Se o spike falhar, a camada de tempo real é reavaliada
com novo ADR antes de seguir.
