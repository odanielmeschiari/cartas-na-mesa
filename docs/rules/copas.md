# Copas (Hearts) — variante tradicional

Regras do jogo como implementadas em `packages/core/src/hearts.ts`. Os itens em
[Decisões a confirmar](#decisões-a-confirmar) são padrões da variante tradicional adotados para
destravar a implementação; o usuário pode alterá-los.

## Visão geral

- **Jogadores:** exatamente 4, em assentos numerados de 0 a 3 no sentido horário. Na mesa, assentos
  vagos são ocupados por bots (online ou offline); a regra do jogo não muda.
- **Baralho:** 52 cartas, sem coringas. Ordem crescente: 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A
  (o Ás é a mais alta).
- **Objetivo:** fazer **o menor número de pontos**. Não existe naipe de trunfo.
- **Pontos:** cada copa vale 1 ponto e a dama de espadas vale 13. Cada mão soma **26 pontos**.
- **Fim da partida:** ao fim da mão em que alguém chega a **100 pontos ou mais**, vence quem tem
  o menor total.

## Desenrolar de uma mão

1. **Distribuição:** 13 cartas para cada jogador, uma a uma no sentido horário.
2. **Passe de cartas:** cada jogador escolhe 3 cartas e as passa, viradas para baixo. O destino
   alterna a cada mão:
   1. mão 1: esquerda (o próximo a jogar);
   2. mão 2: direita;
   3. mão 3: frente (o parceiro da frente);
   4. mão 4: sem passe;
   5. a partir da mão 5, o ciclo recomeça.
3. **Abertura:** quem tem o **2 de paus** abre o primeiro truque, obrigatoriamente com ele.
4. **Truques (vazas):** 13 truques por mão, jogados no sentido horário. Quem vence o truque leva as
   4 cartas e abre o próximo.
5. **Fim da mão:** contam-se os pontos das cartas capturadas por cada jogador e somam-se ao total.

## Jogadas legais

- **Seguir o naipe:** quem tem o naipe da abertura é obrigado a jogá-lo.
- **Sem o naipe:** pode jogar qualquer carta, exceto no primeiro truque (abaixo).
- **Primeiro truque:** sem paus na mão, não se joga copa nem a dama de espadas, a menos que a mão
  só tenha cartas de ponto.
- **Quebrar as copas:** não se abre um truque com copa enquanto nenhuma copa tiver sido jogada,
  a menos que a mão só tenha copas. A **dama de espadas pode abrir** o truque a qualquer momento.
- **Vencedor do truque:** a maior carta do naipe da abertura. Cartas de outros naipes nunca vencem.

## Pontuação

- Cada jogador soma os pontos das cartas que capturou.
- **Virar a lua:** quem captura as 26 pontos na mesma mão faz **0** e os outros três fazem **26**
  cada.
- **Empate:** se, ao fim da mão, alguém chegou a 100 e o menor total está empatado, joga-se mais
  uma mão.

## Decisões a confirmar

Cada item abaixo é o padrão adotado; mudar qualquer um exige atualizar este documento, o código
e os testes.

| Tema | Padrão adotado | Alternativa comum |
| --- | --- | --- |
| Virar a lua | Os outros somam 26 e o autor faz 0 | O autor subtrai 26 do próprio total |
| Quebrar as copas | Só uma copa jogada quebra | A dama de espadas também quebra |
| Dama de espadas no 1º truque | Proibida se houver outra carta jogável | Permitida |
| Valete de ouros | Não é usado | Vale −10 pontos |
| Fim da partida | Alguém chega a 100; menor total vence | Placar-alvo configurável |
| Empate no menor total | Joga-se mais uma mão | Vitória compartilhada |

## Requisitos para o motor (próximos passos)

- **Informação oculta:** as mãos nunca trafegam para quem não pode vê-las, e as 3 cartas escolhidas
  para o passe também são ocultas até os 4 jogadores confirmarem.
- **Mesa fixa de 4:** `playerCount` do jogo é `{ min: 4, max: 4 }`; bots completam assentos vagos e
  usam apenas a visão do próprio assento.
- **Jogador ausente:** tempo limite com ação automática, sem travar a partida.
- **Aleatoriedade:** somente via `Rng` injetado (`dealHands(rng)`); testes usam seed.
