# Cartas na Mesa

Plataforma web de jogos de cartas para jogar rapidamente, sem cadastro: sozinho contra bots, aprendendo com tutoriais ou com amigos em uma sala online.

> **Estado do projeto:** fundação do monorepo, protocolo compartilhado e motor fixture estão implementados. O servidor do spike está implementado conforme o contrato de rede, com testes de integração S1–S4 automatizados, usando servidor e clientes Colyseus reais. A auditoria de segurança do spike foi executada: os dois achados de alto — vazamento de sala vazia sem identidade e conexão sem identidade segurando uma vaga de conexão — foram corrigidos, cada um com teste de regressão. Ainda falta o cliente do spike e os pendentes de endurecimento registrados em `next_tasks.md`. Ainda não é uma versão pronta para jogar.

## Visão do produto

- Salas por código e salas públicas, com identidade anônima e efêmera.
- Partidas contra bots e tutoriais guiados.
- Personalização local de avatar, mesa e aparência das cartas.
- Jogos planejados: Poker, Truco, Canastra e Paciência.
- Acessibilidade e responsividade como critérios de pronto.
- Sem contas, dados pessoais, compras ou dinheiro real; fichas e pontos são fictícios.

## Stack

- TypeScript em todo o projeto e pnpm workspaces.
- `apps/web`: React, Vite, Tailwind CSS, Motion e Zustand.
- `apps/server`: Node.js e Colyseus.
- `packages/core`: regras puras e determinísticas.
- `packages/protocol`: contratos compartilhados validados com Zod.
- Vitest, fast-check e Playwright para testes.

## Estrutura

```text
apps/
  web/       # aplicação web
  server/    # servidor de salas e partidas
packages/
  core/      # domínio e regras puras
  protocol/  # schemas e tipos compartilhados
docs/
  adr/             # decisões arquiteturais
  architecture/    # contratos e arquitetura
next_tasks.md      # progresso e próximas tarefas
```

## Requisitos

- Node.js `>=22.13.0 <23` (consulte `.nvmrc`).
- pnpm `12.18.0`.

## Desenvolvimento

```bash
pnpm install
pnpm dev
```

Comandos disponíveis:

```bash
pnpm build
pnpm test
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm format:check
```

O projeto usa uma dependência Git transitiva do Colyseus (`uWebSockets.js`) e por isso define `blockExoticSubdeps: false` em `pnpm-workspace.yaml` (o pnpm 12 lê as opções do projeto de `pnpm-workspace.yaml`; do `.npmrc` só lê auth, registry, TLS, proxy e endereço local). A instalação reproduzível com lockfile foi validada com `pnpm install --frozen-lockfile`, e o `pnpm-lock.yaml` está commitado. Consulte `next_tasks.md` antes de retomar o trabalho.

## Arquitetura e contribuição

O servidor é autoritativo: clientes enviam intenções, e o servidor valida e aplica as ações. Estados privados devem ser projetados por jogador, sem expor mãos alheias. As regras ficam no domínio puro; a infraestrutura de salas não deve conhecer regras de um jogo específico. Reutilize ao máximo mecânicas e componentes compartilhados entre jogos, mantendo as regras particulares em seus módulos.

Leia [`AGENTS.md`](./AGENTS.md) para os princípios, restrições e fluxo obrigatório de trabalho. Decisões e o progresso atual estão documentados em [`docs/adr/`](./docs/adr/), [`docs/architecture/`](./docs/architecture/) e [`next_tasks.md`](./next_tasks.md).
