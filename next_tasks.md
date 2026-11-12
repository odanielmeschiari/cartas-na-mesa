# Próximas tarefas — Cartas na Mesa

> **Handoff para nova sessão.** Antes de qualquer ação: ler `AGENTS.md` integralmente e
> `docs/adr/0001-stack.md`. A stack está decidida; não reabrir sem pedido do usuário.

**Estado em 2026-11-11:** sem código, stack aprovada, ADR-001 aceito, 9 agentes definidos.
Nada foi commitado ainda.

## Como executar

- Cada item abaixo é **um passo atômico**: um brief, um responsável, um critério de pronto.
- Se a tarefa crescer, quebrar antes de começar.
- Nenhum scaffold, dependência ou comando destrutivo sem autorização explícita.
- Gate obrigatório ao fim de cada bloco: `tester` + `reviewer` + `security` quando aplicável.
- Decisão de produto em aberto não se resolve por suposição: perguntar ao usuário.

## P0 — Validar a fundação (bloqueia todo o resto)

### 1. Scaffold do monorepo

**Resumo:** criar pnpm workspaces com `apps/web`, `apps/server`, `packages/core` e
`packages/protocol`; TypeScript strict, lint/format, scripts `dev`, `test`, `test:e2e`, `lint` e
`typecheck`; versões de Node/pnpm fixadas e lockfile. Sem código de jogo.
**Agente:** `implementer` · **Depende:** autorização para instalar dependências
**Pronto quando:** instalação, `typecheck` e `lint` passam nos pacotes vazios.

### 2. Contratos do fixture

**Resumo:** em `packages/protocol`, definir com Zod os schemas do fixture: código de sala, entrada
na sala, assento, ação, evento do servidor e visão pública. Tipos inferidos dos schemas, sem
dependência de React/Colyseus.
**Agente:** `implementer` (contrato validado pelo `architect`) · **Depende:** item 1
**Pronto quando:** schemas aceitam payloads válidos, rejeitam inválidos e têm testes próprios.

### 3. Motor mínimo e determinístico

**Resumo:** em `packages/core`, definir a interface `GameDefinition` (estado inicial, ações legais,
aplicação de ação, visão por jogador, resultado) e o jogo-fixture trivial com RNG seedado.
**Agente:** `implementer` · **Depende:** item 2
**Pronto quando:** Vitest cobre transições, determinismo e ocultação de mão; fast-check valida os
invariantes do fixture.

### 4. Spike do servidor Colyseus

**Resumo:** sala autoritativa com entrada por código, aplicação de ação somente no servidor,
`StateView` por jogador e token de sessão para reconexão. Sem bots, tutorial ou persistência.
**Agente:** `implementer` · **Depende:** item 3
**Pronto quando:** S1–S3 do ADR passam em teste de servidor/payload e a reconexão preserva assento.

### 5. Spike do cliente mínimo

**Resumo:** tela crua em `apps/web` para criar/entrar por código, renderizar a própria mão, enviar
ação e reconectar. Sem UI final, sem assets.
**Agente:** `implementer` (layout mínimo com `designer` se necessário) · **Depende:** item 4
**Pronto quando:** duas abas completam S1–S4 do ADR.

### 6. Gate do spike

**Resumo:** automatizar S1–S4 com Playwright e asserção de payload; revisão independente e
auditoria de vazamento de informação oculta.
**Agentes:** `tester`, `reviewer`, `security` · **Depende:** item 5
**Pronto quando:** S1–S4 passam automatizados, zero achados bloqueantes e o ADR é atualizado se
algo falhar. **Se o spike falhar, reavaliar Colyseus antes de qualquer regra de jogo.**

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
