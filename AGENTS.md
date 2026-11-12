# Cartas na Mesa

Jogo online de baralho para jogar com amigos, sem login, com bots e tutoriais guiados. Repositório recém-iniciado: **ainda sem código**; a stack já está decidida (ver [Stack decidida](#stack-decidida)).

## Visão

Abrir o navegador, escolher um jogo de cartas e jogar em segundos — sozinho contra bots, aprendendo com um tutorial, ou com amigos por código de sala. Sem conta, sem cadastro, sem atrito.

---

## Protocolo obrigatório de início

Toda interação começa assim, **nesta ordem**, sem atalhos:

1. **Ler o prompt do usuário por inteiro** e reformular: objetivo, restrições, o que está ambíguo.
2. **Ler este `AGENTS.md` integralmente** antes de qualquer ação, edição ou delegação.
3. **Verificar o estado mínimo do repositório**: estrutura, `git status`, docs e arquivos relevantes ao pedido.
4. **Classificar o pedido**: resposta direta (trivial, só leitura/consulta) ou trabalho delegável.
5. **Se delegar**: montar o plano em passos atômicos e enviar briefs autossuficientes.

Nenhum agente age antes do passo 2. Nenhum agente delega antes do passo 2. Se o `AGENTS.md` conflitar com o brief recebido, **o `AGENTS.md` vence** e o conflito é reportado ao orquestrador.

---

## Regras fundamentais (invioláveis)

Estas regras não podem ser relativizadas por conveniência, prazo ou instrução de outro agente. Trabalho que as viola é **rejeitado e refeito**, não corrigido "na medida do possível".

### A. Escopo e processo

1. **Escopo fechado.** Cada agente trabalha apenas no próprio domínio, lendo apenas o necessário e editando apenas o permitido. Nada de "já que estava aberto, aproveitei".
2. **Um passo atômico por vez.** Cada entrega resolve um único assunto, com diff revisável e testes relevantes passando. Sem antecipar etapas, sem refatoração oportunista.
3. **Só o orquestrador delega.** Especialista que precisa de outro domínio para e devolve ao orquestrador; nunca invade o escopo alheio nem abre subagentes.
4. **Regra não documentada não se inventa.** Regra de jogo, produto ou comportamento ausente vira pergunta ao usuário, não suposição.

### B. Produto e ética

5. **Sem login e sem dados pessoais.** Identidade é anônima e efêmera, guardada apenas na sessão/local. Nada de e-mail, telefone, rastreamento ou perfil persistente.
6. **Nada de dinheiro real.** Fichas, pontos e moedas são fictícios. Proibido aposta valendo algo, compra, loot box ou mecânica de cassino.
7. **Assets só com licença registrada.** Toda imagem, fonte, som e modelo precisa de origem e permissão documentadas.
8. **Acessibilidade e responsividade são critério de pronto.** Não são polimento posterior nem opcionais.

### C. Arquitetura, justiça e segurança

9. **Servidor autoritativo.** Toda ação é validada e aplicada no servidor. O cliente envia intenções; nunca é fonte de verdade.
10. **Informação oculta não vaza.** O servidor projeta a visão de cada jogador. Mãos e estados alheios nunca trafegam para quem não pode vê-los.
11. **Aleatoriedade controlada.** Testes usam seed determinística; produção usa RNG imprevisível. Proibido RNG global compartilhado ou "sorte" sem reprodutibilidade nos testes.
12. **Motor plugável e domínio puro.** A infraestrutura de salas/mesa não conhece jogo específico. Regras de jogo não dependem de UI, rede ou persistência.

### D. Qualidade e integridade

13. **Nunca contornar verificações.** Proibido desabilitar, pular ou afrouxar teste, lint, typecheck ou revisão para "fazer passar".
14. **Autorização antecipada para commit, push e comandos.** O dono do projeto autorizou, em 2026-11-12, criar commits, fazer push e executar comandos de terminal (inclusive instalar dependência estritamente necessária) sem pedir permissão a cada ocorrência, desde que sejam **estritamente necessários para prosseguir trabalhando no projeto**. Continuam exigindo pedido explícito do usuário as operações destrutivas ou irreversíveis fora desse escopo: `push --force` ou reescrita de histórico em `main`, `reset --hard`, descarte de commits, exclusão de branches ou tags, publicação de pacotes, criação de segredo, migração destrutiva e alterações de ambiente que não sejam estritamente necessárias ao trabalho em andamento.
15. **Entrada externa é hostil.** Validar na borda e novamente no servidor; proibido erro silencioso, `catch` vazio ou fallback que esconde falha.
16. **Verificação fecha o trabalho.** Revisor e auditor apontam, não corrigem. Nada é considerado pronto sem passar pelo gate de verificação.

---

## Fluxo de trabalho geral

```text
[0] Intake ─► [1] Descoberta/Arquitetura ─► [2] Implementação atômica
                                                    │
                                                    ▼
[4] Documentação ◄─ [3] Gate: tester + reviewer + security
```

### Etapa 0 — Intake (orquestrador)

1. Ler o prompt e reformular o objetivo em uma frase.
2. Ler o `AGENTS.md` integralmente.
3. Checar o estado mínimo do repositório.
4. Decidir: responder direto (trivial) ou delegar.
5. Para trabalho com **3 ou mais etapas**, apresentar o plano antes de executar; para o resto, executar e reportar.
6. Cada etapa do plano deve caber em **um brief = um passo atômico**.

### Etapa 1 — Descoberta e decisão

- `researcher` quando falta informação (biblioteca, regra, referência).
- `architect` quando a decisão é estrutural ou afeta mais de um módulo.
- `designer` quando a mudança é de UX/UI, mesa, cartas ou acessibilidade.

Gate: nenhuma implementação começa sobre decisão estrutural ainda em aberto.

### Etapa 2 — Implementação atômica

- Um `implementer` por passo e por área de arquivos.
- Definição de passo atômico: **um assunto**, diff revisável (referência: até ~200 linhas), apenas arquivos necessários, testes relevantes passando.
- Depois de cada passo: implementer reporta; orquestrador confere escopo e diff; só então o próximo passo.
- Se o passo crescer, o orquestrador o quebra. Não se "aproveita a viagem".

### Etapa 3 — Gate de verificação

- `tester`, `reviewer` e `security` atuam em paralelo sobre a mudança acumulada, cada um no seu escopo.
- Achados **bloqueantes** voltam ao `implementer` como um novo passo atômico.
- Máximo de **2 ciclos** de correção por etapa; se persistir, o orquestrador escala ao usuário com o diagnóstico.

### Etapa 4 — Documentação e fechamento

- `documenter` atualiza README, regras, guias e ADRs quando o comportamento muda.
- Orquestrador consolida: o que foi feito, arquivos, comandos/testes, achados, riscos e próximo passo.
- Commit/push conforme a autorização antecipada da regra 14.

### Brief obrigatório

```text
Objetivo:
Contexto:
Escopo de leitura (arquivos/pastas):
Escopo de escrita (o que pode alterar):
Restrições:
Entregável esperado:
Critério de pronto:
```

### Critério de pronto (todos simultaneamente)

- Comportamento pedido implementado, sem efeito colateral conhecido.
- Testes relevantes passando; novo comportamento coberto.
- Sem violação das regras fundamentais.
- Escopo respeitado: nenhum arquivo fora do combinado.
- Documentação atualizada quando o comportamento mudou.

### Condições de parada

Pare e reporte ao orquestrador quando: faltar decisão de produto, a tarefa exigir outro domínio, um teste falhar por causa alheia, ou for necessário algo irreversível.

---

## Escopo dos agentes

| Agente | Lê | Escreve | Nunca faz |
| --- | --- | --- | --- |
| `orchestrator` | `AGENTS.md`, estrutura do repo, `git status`, relatórios | Nada | Implementar, editar, rodar comando destrutivo |
| `architect` | Docs e trechos de código necessários para decidir | `docs/architecture/**`, `docs/adr/**` | Implementar feature |
| `researcher` | Fontes relevantes à pergunta | Nada | Editar, instalar, inventar fonte |
| `implementer` | `AGENTS.md`, arquitetura/ADRs, arquivos-alvo, dependências diretas e testes vizinhos | Código de produção; testes só se o brief autorizar | Alterar teste para passar, push, dependência sem aval |
| `designer` | Referências visuais, UI e assets | UI, `assets/**`, `docs/design/**` | Tocar regra de jogo, domínio ou rede |
| `tester` | Código sob teste, config e fixtures | Apenas testes e fixtures | Editar código de produção |
| `reviewer` | Diff e código afetado | Nada | Corrigir achados |
| `security` | Manifestos, configs e trechos sinalizados | Nada | Explorar fora do ambiente local, corrigir |
| `documenter` | Código/testes necessários para documentar com precisão | Markdown e `docs/**` | Documentar sem verificar no código |

**Leitura mínima:** use `grep`/`glob` direcionados e abra só o arquivo necessário e seu entorno imediato. Varredura ampla é permitida apenas a `researcher` e `architect`, e ainda assim limitada à pergunta. Se precisar abrir algo fora do escopo, justifique no relatório.

---

## Regras de implementação e boas práticas

### Antes de escrever

- Leia o arquivo-alvo, os vizinhos imediatos e os testes que cobrem o comportamento.
- Siga o padrão existente; não introduza estilo paralelo.
- Se o brief estiver incompleto, pare antes de codar.

### Código

- Menor mudança possível que resolve o problema. Um conceito por diff.
- Nomes claros; funções pequenas; dependências explícitas.
- Domínio puro e determinístico; efeitos colaterais nas bordas.
- Tipos explícitos; sem `any`, cast inseguro ou validação presumida.
- Estado imutável quando possível; transições explícitas.
- Erros propagados com contexto; sem `catch` vazio nem fallback que esconde falha.
- Nada de código morto ou comentado. Comentário explica **por quê**, não o quê.
- Sem segredo, token ou dado real no código, em log ou em fixture.
- Sem otimização prematura: meça antes.

### Dependências e infraestrutura

- Dependência nova exige justificativa: problema, alternativas, custo de manutenção.
- Sem comando destrutivo, migração irreversível ou alteração de ambiente que não seja estritamente necessária ao trabalho em andamento sem autorização.
- Configuração sensível por variável de ambiente, com exemplo versionado sem valor real.

### Testes

- Todo bug corrigido nasce com teste de regressão.
- Teste de comportamento e regra, não de implementação.
- Determinismo sempre: seed explícita, sem depender de relógio ou rede.
- Não perseguir cobertura por cobertura.

### UI e acessibilidade

- Estados de carregamento, vazio e erro previstos.
- Navegável por teclado, com foco visível.
- Cor nunca é o único indicador de estado (use forma, símbolo ou rótulo).
- Respeitar `prefers-reduced-motion`; animação curta e não bloqueante.
- Responsivo: mesa jogável em desktop e celular.

### Documentação

- Mudança de comportamento atualiza a doc no mesmo fluxo.
- Não documente suposição: verifique no código/teste ou marque como pendência.

### Sinais de que o passo não é atômico

- Mistura dois assuntos (ex.: "cria a sala e o chat").
- Toca arquivos não relacionados.
- Exige dois especialistas ao mesmo tempo.
- Diff muito acima de ~200 linhas sem ser dado/gerado.
- Não dá para descrever o critério de pronto em uma frase.

---

## Princípios de produto

- **Zero atrito**: entrar e jogar. Nada de login, e-mail ou senha.
- **Amigável**: interface acolhedora, instruções claras e feedback imediato; nada de parecer cassino agressivo.
- **Aprender jogando**: tutoriais guiados e bots com dificuldade progressiva.
- **Mesa antes de menu**: a partida ocupa a tela; menus são discretos e contextuais.
- **Acessível**: teclado, leitores de tela, contraste, daltonismo e movimento reduzido.
- **Extensível**: novos jogos de cartas entram como módulos, sem reescrever a infraestrutura.
- **Reuso máximo**: identificar e reutilizar mecânicas e componentes realmente compartilhados entre jogos, em vez de duplicá-los. Isso inclui, quando aplicável, embaralhamento, distribuição/compra de cartas, animações e interações comuns. Manter as regras específicas de cada jogo nos respectivos módulos; abstrações compartilhadas não devem forçar jogos diferentes a adotar o mesmo comportamento quando as regras não forem iguais.
- **Somente fichas fictícias**: nada de dinheiro real, compras, loot boxes ou apostas.

## Funcionalidades obrigatórias

### Salas e modo online

- Criar sala e receber um **código curto** para compartilhar.
- Entrar em sala por código.
- **Salas públicas** listadas no modo online, com nome, jogo, vagas e status.
- Dono da sala define o jogo, as regras/variante e inicia a partida.
- Jogadores podem sair, e a sala lida com desconexão e reconexão sem perder a partida.
- Identidade anônima por sessão: apelido + avatar escolhidos ao entrar, lembrados localmente.

### Bots

- Partidas completas contra bots, com níveis de dificuldade.
- Bots ocupam assentos vagos para completar uma mesa.
- Bots jogam com as mesmas regras e informações limitadas que um humano (nada de ver cartas alheias).

### Tutoriais

- Tutoriais guiados por passos, com destaque no elemento e instrução no centro da mesa
  (ex.: "Passe três cartas para Charlie").
- Cada jogo tem seu próprio tutorial, curto e jogável, não um manual de texto.

### Personalização

- Avatar pessoal.
- Fundo da mesa: feltro verde, madeira e wallpapers temáticos.
- Aparência das cartas: face e verso (naipes/baralho), com modelos enviados pelo autor do projeto.
- Preferências salvas localmente (sem conta), aplicadas na mesa e nos tutoriais.

### Jogos de cartas

Mecânicas distintas, compartilhando a mesma infraestrutura de mesa, assentos, turnos e salas:

- **Poker** — apostas, rodadas de aposta, informação oculta, showdown. Apenas fichas fictícias.
- **Truco** — times, valor de mão, pedidos de truco, pontuação até a vitória.
- **Canastra** — jogos/melds, sequências e trincas, compra do lixo, pontuação.
- **Paciência (Solitaire)** — um jogador, colunas de tabuleiro, células livres e pilhas de fundação.
- **Extensível** — o catálogo cresce; cada jogo é um módulo com regras próprias.

## Direção visual

Referências recebidas (mesa de 4 lugares e paciência em madeira):

- Visão **de cima** da mesa, com jogadores sentados ao redor.
- Cada assento mostra **avatar, apelido e vidas/corações**; o jogador local fica na parte de baixo, com a mão em leque.
- Cartas dos oponentes viram **montes de costas** nas laterais/superior.
- **Faixa central** escura e legível para instruções e avisos da partida.
- Fundos: **feltro verde**, **madeira** e wallpapers; cartas brancas com cantos arredondados e artes clássicas; versos ornamentados em azul.
- Paciência: tabuleiro em madeira, 8 colunas, 4 células livres e 4 pilhas de fundação, com rótulos discretos
  ("Célula livre", "Pilhas de fundação", "Tabulário") e barra de ações no topo.
- Estética: casual, limpa e legível — a arte da carta nunca pode comprometer número e naipe.

## Stack decidida

Decisão do autor do projeto. O `architect` registra em ADR **antes** do primeiro código e não a substitui por preferência própria.

- **Linguagem**: TypeScript em todo o projeto.
- **Monorepo**: pnpm workspaces.
  - `apps/web` — React + Vite + Tailwind CSS + Motion; estado local com Zustand.
  - `apps/server` — Node + Colyseus (salas, presença, reconexão, listagem de salas e `StateView`).
  - `packages/core` — regras puras, determinísticas, sem UI, rede ou persistência.
  - `packages/protocol` — tipos e schemas Zod compartilhados entre cliente e servidor.
- **Validação**: Zod nas bordas e novamente no servidor.
- **Testes**: Vitest (unidade/integração), fast-check (invariantes), Playwright (E2E).
- **Persistência**: nenhuma no MVP; salas em memória. Postgres/Redis entram só quando houver histórico ou necessidade de escala, com novo ADR.
- **Deploy**: um serviço Node + cliente estático, em container.
- **Versões**: últimas estáveis no momento da implementação, fixadas no lockfile.

### Validação obrigatória antes de espalhar o padrão

Spike mínimo, em um único passo atômico: duas conexões na mesma sala, estado autoritativo,
uma informação oculta por jogador via `StateView` e reconexão. Se o spike falhar, a stack de
tempo real é reavaliada **antes** de qualquer regra de jogo.

## Arquitetura de referência

Alinhada à stack decidida e a detalhar pelo `architect` antes da primeira implementação:

- **Cliente web responsivo** (desktop e mobile), com a mesa como tela principal.
- **Servidor autoritativo** para salas e partidas: o cliente envia intenções, o servidor valida e aplica.
- **Tempo real por WebSocket** para estado da sala e jogadas; reconexão com token de sessão.
- **Motor de regras plugável**: cada jogo define configuração, estado inicial, ações legais, aplicação de ação,
  pontuação, bot e tutorial. A infraestrutura não conhece as regras de nenhum jogo específico.
- **Informação oculta obrigatória**: o servidor projeta a visão de cada jogador ("state view"), enviando apenas
  o que ele pode ver. Mãos alheias nunca trafegam para o cliente.
- **RNG determinístico com seed**: embaralhamento reproduzível para testes e replays.
- **Bots no servidor**, usando apenas a visão do próprio jogador.
- **Tutoriais como scripts de passos** sobre o mesmo motor, não uma implementação paralela.
- **Salas efêmeras** por padrão; decidir depois o que vale persistir (histórico, estatísticas locais).

### Conceitos de domínio

`Jogo`, `Variante`, `Regra`, `Partida`, `Sala`, `Assento`, `Jogador`, `Carta`, `Baralho`, `Mão`, `Mesa`,
`Turno`, `Ação`, `Evento`, `Resultado`. Regras ficam em domínio puro, sem UI, rede ou persistência.

## Requisitos não funcionais

- **Responsivo**: mesa confortável em desktop e jogável em celular (mão em leque, assentos compactos).
- **Rápido**: entrada em sala e feedback de jogada perceptivelmente instantâneos; animações curtas.
- **Acessível**: navegação por teclado, foco visível, contraste AA, cartas com alternativa textual,
  estado indicado por cor **e** forma/símbolo, respeito a `prefers-reduced-motion`.
- **Seguro por padrão**: código de sala não adivinhável, limite de tentativas, validação de toda ação no servidor,
  sem segredos no cliente, sem confiar no estado enviado pelo cliente.
- **Justo**: RNG imprevisível em produção e auditável nos testes; servidor autoritativo contra trapaça.
- **Tolerante a falhas**: queda de conexão não encerra a partida; jogador ausente tem tempo limite/ação automática.

## Estrutura de assets

```text
assets/
  cards/          # faces e versos por baralho (enviados pelo autor do projeto)
  backgrounds/    # feltro verde, madeira, wallpapers
  avatars/        # avatares disponíveis
  ui/             # ícones, corações, mesas, elementos de interface
docs/
  rules/          # regras de cada jogo em linguagem clara
  design/         # specs de UX/UI, tokens e telas
  architecture/   # arquitetura, contratos e diagramas
  adr/            # decisões arquiteturais
```

Registrar a origem/licença de cada asset. Não usar material de terceiros sem permissão.

## Convenções

- Código e identificadores em inglês; documentação e comunicação em pt-BR.
- Mudanças pequenas e focadas; sem reformatar arquivos não relacionados.
- Commit, push e comandos de terminal: autorizados antecipadamente pelo dono do projeto (2026-11-12), sem pedido a cada ocorrência, desde que estritamente necessários para prosseguir trabalhando no projeto; operações destrutivas ou irreversíveis fora desse escopo continuam exigindo pedido explícito.
- Nunca commitar segredos, chaves ou dados reais.
- Toda aleatoriedade do jogo recebe seed; testes não podem depender de sorte.
- Regras do jogo no domínio, separadas de UI, persistência e rede.
- Nenhum jogo específico pode ser "hardcoded" na infraestrutura de salas/mesa.
- Reutilizar ao máximo mecânicas e componentes comuns entre jogos (por exemplo, animações e operações de embaralhamento, distribuição e compra de cartas), mantendo em cada módulo as regras que forem específicas da modalidade.
- Acessibilidade e responsividade fazem parte do critério de pronto.
- Fichas, pontos e moedas são sempre fictícios.

## Decisões pendentes

- Poker: qual variante (Texas Hold'em?) e profundidade de apostas no MVP.
- Truco: variante (Paulista, Mineiro, Gaúcho) e número de jogadores por mesa.
- Canastra: variante e regras de pontuação.
- Paciência: Klondike apenas ou múltiplas variações.
- Chat de sala, emotes e moderação de salas públicas.
- Persistência: salas só em memória ou histórico de partidas.
- Aplicativo nativo ou apenas web instalável (PWA).

## Fora de escopo inicial

- Contas, login, progressão permanente e compras.
- Dinheiro real, apostas valendo algo ou caça-níqueis.
- Torneios, rankings globais e matchmaking ranqueado.
- Voz, vídeo e tradução para outros idiomas.

## Comandos

> Previstos para o monorepo; serão criados no scaffold e ajustados conforme os pacotes reais.

```bash
pnpm install        # dependências
pnpm dev            # cliente + servidor
pnpm test           # Vitest
pnpm test:e2e       # Playwright
pnpm lint           # lint
pnpm typecheck      # checagem de tipos
```
