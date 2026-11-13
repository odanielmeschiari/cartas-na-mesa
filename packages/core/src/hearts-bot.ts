import { createDeck } from './patience';
import { heartsRank, isHeart, isPointCard, isQueenOfSpades, type HeartsCard } from './hearts';
import type { HeartsActionPayload, HeartsPrivateView, HeartsPublicView } from './hearts-game';

// Bot fácil do Copas: heurística determinística. Só enxerga a visão do próprio assento
// (HeartsPrivateView) e a visão pública da mesa; nunca o estado completo nem mãos alheias.

const CARDS_BY_ID = new Map(createDeck().map((card) => [card.id, card]));

function byRank(a: HeartsCard, b: HeartsCard): number {
  return heartsRank(a) - heartsRank(b) || a.id.localeCompare(b.id);
}

function lowest(cards: readonly HeartsCard[]): HeartsCard | undefined {
  return [...cards].sort(byRank)[0];
}

function highest(cards: readonly HeartsCard[]): HeartsCard | undefined {
  return [...cards].sort(byRank).at(-1);
}

/** Quanto mais perigosa a carta para quem a guarda, mais cedo ela é passada. */
function danger(card: HeartsCard, holdsQueen: boolean): number {
  if (isQueenOfSpades(card)) return 1000;
  if (card.suit === 'espada' && heartsRank(card) >= 13 && !holdsQueen) {
    return 500 + heartsRank(card);
  }
  return (isHeart(card) ? 100 : 0) + heartsRank(card);
}

function choosePass(hand: readonly HeartsCard[]): HeartsActionPayload {
  const holdsQueen = hand.some(isQueenOfSpades);
  const ranked = [...hand].sort(
    (a, b) => danger(b, holdsQueen) - danger(a, holdsQueen) || a.id.localeCompare(b.id),
  );
  return { type: 'pass_cards', cardIds: ranked.slice(0, 3).map((card) => card.id) };
}

function dump(cards: readonly HeartsCard[]): HeartsCard | undefined {
  return cards.find(isQueenOfSpades) ?? highest(cards.filter(isHeart)) ?? highest(cards);
}

function choosePlay(cards: readonly HeartsCard[], table: HeartsPublicView): HeartsCard | undefined {
  const trick = table.trick.flatMap((play) => CARDS_BY_ID.get(play.cardId) ?? []);
  const lead = trick[0];
  if (lead === undefined) {
    // Abertura: a carta mais baixa, deixando as copas para o fim.
    return lowest(cards.filter((card) => !isHeart(card))) ?? lowest(cards);
  }
  const follow = cards.filter((card) => card.suit === lead.suit);
  if (follow.length === 0) return dump(cards);

  const winning = Math.max(...trick.filter((c) => c.suit === lead.suit).map(heartsRank));
  const ducks = follow.filter((card) => heartsRank(card) < winning);
  if (ducks.length > 0) return highest(ducks);
  // Última jogada e truque sem pontos: ganhar não custa nada.
  if (trick.length === 3 && !trick.some(isPointCard)) return highest(follow);
  return lowest(follow);
}

/**
 * Escolhe uma ação legal para o assento dono de `own`, ou null se não houver nenhuma.
 * Na jogada, só considera cartas de `own.legalActions`; o passe aceita quaisquer 3 cartas da mão.
 */
export function chooseEasyAction(
  own: HeartsPrivateView,
  table: HeartsPublicView,
): HeartsActionPayload | null {
  const first = own.legalActions[0];
  if (first === undefined) return null;
  if (first.type === 'pass_cards') return choosePass(own.hand);
  const legalIds = new Set(
    own.legalActions.flatMap((action) => (action.type === 'play_card' ? [action.cardId] : [])),
  );
  const cards = own.hand.filter((card) => legalIds.has(card.id));
  const chosen = choosePlay(cards, table);
  return chosen === undefined ? first : { type: 'play_card', cardId: chosen.id };
}
