# ADR-001 — Stack do MVP

- **Status:** Aceito
- **Data:** 2026-11-11
- **Decisores:** autor do projeto
- **Fonte da decisão:** `AGENTS.md`, seção "Stack decidida"
- **Escopo:** stack do MVP e base do monorepo; não define regras de jogo nem arquitetura interna detalhada

## Contexto

"Cartas na Mesa" é um jogo online de baralho, sem login, com salas por código, salas públicas
listadas, bots, tutoriais guiados e múltiplos jogos (Poker, Truco, Canastra e Paciência).
O repositório está recém-iniciado e ainda não tem código.

Requisitos que condicionam a stack:

- **Servidor autoritativo:** o cliente envia intenções; o servidor valida e aplica. O cliente
  nunca é fonte de verdade.
- **Informação oculta:** mãos e estados alheios não podem trafegar para quem não pode vê-los.
  O servidor precisa projetar uma visão por jogador.
- **Tempo real:** estado de sala, presença, entrada/saída e jogadas; queda de conexão não encerra
  a partida e a reconexão deve preservar assento e estado.
- **Motor plugável:** a infraestrutura de salas/mesa não conhece jogo específico; regras ficam em
  domínio puro, determinístico, sem UI, rede ou persistência.
- **Determinismo:** RNG com seed nos testes; aleatoriedade imprevisível em produção.
- **Zero atrito e baixo custo operacional:** sem conta e, no MVP, sem persistência.

A stack já foi decidida pelo autor. Este ADR registra a decisão, o contexto, as alternativas
descartadas e as consequências; não a reabre nem a substitui por preferência do `architect`.

## Decisão

| Área | Decisão |
| --- | --- |
| Linguagem | TypeScript em todo o projeto |
| Monorepo | pnpm workspaces |
| Cliente | `apps/web`: React + Vite + Tailwind CSS + Motion; estado local com Zustand |
| Servidor | `apps/server`: Node + Colyseus (salas, presença, reconexão, listagem de salas públicas e `StateView`) |
| Domínio | `packages/core`: regras puras, determinísticas, sem UI, rede ou persistência |
| Contratos | `packages/protocol`: tipos e schemas Zod compartilhados entre cliente e servidor |
| Validação | Zod nas bordas e novamente no servidor |
| Testes | Vitest (unidade/integração), fast-check (invariantes) e Playwright (E2E) |
| Persistência | Nenhuma no MVP; salas em memória. Postgres/Redis somente depois, com novo ADR |
| Deploy | Um serviço Node + cliente estático, em container |
| Versões | Últimas estáveis no momento da implementação, fixadas no lockfile |

Consequências estruturais diretas:

- Os contratos de rede e os tipos de ações/eventos pertencem a `packages/protocol`; cliente e
  servidor não duplicam schemas.
- `packages/core` não importa Colyseus, React, Zod de transporte, nem acesso a rede/armazenamento.
- `apps/server` hospeda a infraestrutura de salas e adapta ações validadas para o motor de regras.
- `apps/web` consome apenas o estado projetado pelo servidor; nenhuma regra de jogo é duplicada no
  cliente para "ganhar" latência.

## Alternativas consideradas

Todas foram descartadas pelo autor. O registro abaixo preserva o motivo arquitetural, sem
reabrir a decisão.

| Alternativa | Por que foi descartada |
| --- | --- |
| **Fastify + `ws`** | Exigiria construir à mão salas, presença, reconexão, sincronização de estado e listagem de salas. É uma base viável, mas aumenta o escopo de infraestrutura antes de validar o produto. |
| **Socket.IO** | Maduro para transporte e reconexão, porém a sincronização de estado por sala, a projeção por jogador e o ciclo de vida de salas continuariam manuais. A decisão prioriza uma camada de salas pronta. |
| **Python/FastAPI** | Quebraria o compartilhamento de tipos ponta a ponta em TypeScript e exigiria justificar uma segunda linguagem e dois ecossistemas de teste/build. |
| **Next.js** | Centraliza renderização e rotas, mas o núcleo do produto é estado de sala em tempo real e servidor autoritativo, não renderização no servidor. Adicionaria complexidade de framework sem resolver a camada de salas. |
| **PartyKit** | Plataforma gerenciada de tempo real; desloca o ciclo de vida das salas e o deploy para um fornecedor externo, com modelo operacional distinto do "um serviço Node + cliente estático em container". |
| **Supabase** | Traz persistência e serviços gerenciados como ponto de partida, enquanto o MVP decidiu não persistir. Introduziria dependência de fornecedor e modelo de dados antes de existir necessidade. |

## Consequências

### Positivas

- Uma única linguagem e um único conjunto de tipos entre cliente, servidor e domínio.
- Schemas Zod compartilhados reduzem divergência entre validação de borda e contrato de rede.
- Colyseus concentra salas, presença, reconexão e a projeção de estado por jogador, que são
  requisitos centrais do produto.
- `packages/core` isolado permite testar regras com Vitest/fast-check sem rede nem UI, e mantém
  os jogos plugáveis.
- Sem persistência no MVP: menos infraestrutura, menos segredos e menos superfície de dados
  pessoais.
- Deploy simples: um processo Node e arquivos estáticos.

### Negativas e custos

- Acoplamento ao modelo de salas do Colyseus em `apps/server`; trocar de biblioteca depois exige
  uma camada de adaptação e revalidação do spike.
- Salas em memória são perdidas em reinício ou falha do processo. Isso é aceitável no MVP, mas
  limita disponibilidade e histórico.
- Um único serviço Node limita escala horizontal até existir um novo ADR (persistência,
  compartilhamento de estado ou roteamento por sala).
- Curva de aprendizado do Colyseus e do seu modelo de estado/serialização.
- Motion e animações exigem disciplina para não conflitar com acessibilidade e
  `prefers-reduced-motion`.
- O monorepo adiciona configuração de build, tipos e scripts compartilhados antes da primeira
  funcionalidade.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| O `StateView` do Colyseus não filtrar informação oculta como o produto exige | Spike obrigatório com asserção no payload enviado a cada jogador; nenhuma regra de jogo começa antes de o critério passar |
| Reconexão não preservar assento/estado na prática | Spike com queda simulada e verificação de estado antes/depois; definir janela de reconexão depois |
| Estado de sala ou presença vazar para o cliente errado | Testes de contrato no `packages/protocol` e verificação de payload no spike; revisão de segurança no gate |
| Regras de jogo vazarem para a infraestrutura de salas | `packages/core` sem dependência de Colyseus/React; revisão de imports no CI |
| Perda de partidas em reinício do servidor | Aceito no MVP; comunicar limitação; novo ADR antes de exigir persistência |
| Versões "últimas estáveis" quebrarem entre ambientes | Lockfile commitado e versões de Node/pnpm fixadas no scaffold |
| Complexidade do monorepo atrasar o primeiro código | Scaffold mínimo, um pacote por responsabilidade, sem tooling extra antes de necessidade |
| Latência percebida e animações conflitantes no cliente | Medir no E2E; animação curta, não bloqueante, e respeito a `prefers-reduced-motion` |

## Spike de validação

O spike é um **passo separado, a ser implementado depois deste ADR**. Ele não faz parte desta
entrega e não autoriza scaffold, dependências ou código neste momento. Seu objetivo é validar a
camada de tempo real antes de qualquer regra de jogo, conforme `AGENTS.md`.

### Escopo mínimo

- Um único jogo de fixture, trivial e descartável, com duas mãos e uma ação pública, usado apenas
  para exercitar o fluxo. Não é a implementação de Poker, Truco, Canastra ou Paciência.
- Cliente mínimo (sem UI final) capaz de conectar, enviar uma intenção e exibir o estado recebido.
- Servidor com uma sala, estado autoritativo e projeção por jogador.
- Sem persistência, sem bots, sem tutoriais, sem salas públicas e sem deploy.

### Critérios objetivos de aceite

| # | Cenário | Procedimento | Critério de aceite |
| --- | --- | --- | --- |
| S1 | Duas conexões na mesma sala | A cria a sala e recebe um código; B entra pelo mesmo código | Ambos recebem estado com exatamente 2 jogadores, o mesmo identificador de sala e assentos distintos; nenhuma recarga de página é necessária |
| S2 | Estado autoritativo | A envia uma intenção válida; em seguida, um cliente envia uma ação inválida (fora de turno ou não permitida) | A ação válida é aplicada pelo servidor e converge para ambos; a inválida é rejeitada com erro ao remetente e não altera o estado de nenhum cliente |
| S3 | Informação oculta por jogador via `StateView` | Com mãos distintas no fixture, inspecionar o payload recebido por A e por B | O payload de A contém a mão de A e apenas informação pública dos demais; nenhum identificador de carta da mão de B aparece no payload de A (e vice-versa); a verificação é automatizada e falha se a carta alheia estiver presente |
| S4 | Reconexão após queda | A tem a conexão encerrada; A reconecta usando o token de sessão da mesma partida | A volta ao mesmo assento, com a mesma mão e o mesmo estado de turno; a sala continua com 2 jogadores e sem assento duplicado; B observa A ausente enquanto desconectado e presente após reconectar |

### Condições de falha

O spike é considerado **falho** se qualquer critério S1–S4 não passar, se a informação oculta
puder ser inferida do payload, ou se a reconexão criar jogador/assento duplicado. Nesse caso, a
stack de tempo real é reavaliada antes de qualquer regra de jogo, com registro em novo ADR ou
emenda a este.

### Pontos a validar no spike (sem suposição prévia)

- Assinatura e comportamento exatos da API do Colyseus usada para `StateView`, reconexão e
  listagem de salas, na versão estável fixada no momento da implementação.
- Formato e ciclo de vida do token de sessão para reconexão.
- Comportamento de presença/ausência e limites de tempo do servidor.
- Custo e viabilidade de rodar o servidor e o cliente em um único container.

Nenhuma versão, benchmark ou API específica é afirmada neste ADR; o que não foi verificado fica
explicitamente para o spike.

## Decisões em aberto

Não bloqueiam o spike nem a escrita do primeiro código de infraestrutura; devem ser resolvidas
antes da funcionalidade correspondente.

- Versões exatas de Node, pnpm e das dependências; política de atualização.
- Formato e comprimento do código de sala, alfabeto e limite de tentativas.
- Janela de reconexão, tempo limite de jogador ausente e ação automática.
- Regras de listagem de salas públicas (filtro, ordenação, paginação, moderação).
- Onde guardar o token de sessão no cliente e por quanto tempo.
- Estratégia de observabilidade e logs do servidor.
- Alvo de deploy, registry de container e pipeline de CI.
- Critério objetivo para introduzir Postgres/Redis (histórico, escala ou outro), com novo ADR.
- Variantes e profundidade de regras por jogo (Poker, Truco, Canastra, Paciência).
- Chat de sala, emotes e moderação.
- Web instalável (PWA) versus apenas web responsivo.
