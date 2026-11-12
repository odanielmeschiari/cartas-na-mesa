import type { PatienceCard, PatienceSuit } from '@cartas-na-mesa/core';

/**
 * Imagens das cartas vindas da pasta `Cards/` da raiz do repositório.
 * O Vite resolve cada arquivo para uma URL final (com hash) em dev e em build.
 */
const faces = import.meta.glob<string>('../../../../Cards/card_*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const backs = import.meta.glob<string>('../../../../Cards/card backs/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const SUIT_FILE: Record<PatienceSuit, string> = {
  ouro: 'diamond',
  copa: 'heart',
  espada: 'spade',
  paus: 'clubs',
};

const VALUE_NUMBER: Record<PatienceCard['value'], number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13,
};

export const SUIT_SYMBOL: Record<PatienceSuit, string> = {
  ouro: '♦',
  copa: '♥',
  espada: '♠',
  paus: '♣',
};

const SUIT_NAME: Record<PatienceSuit, string> = {
  ouro: 'ouros',
  copa: 'copas',
  espada: 'espadas',
  paus: 'paus',
};

export function cardName(card: PatienceCard): string {
  return `${card.value} de ${SUIT_NAME[card.suit]}`;
}

export function cardFaceUrl(card: PatienceCard): string | undefined {
  return faces[`../../../../Cards/card_${SUIT_FILE[card.suit]}_${VALUE_NUMBER[card.value]}.png`];
}

export function cardBackUrl(): string | undefined {
  return backs['../../../../Cards/card backs/blue_back_suits.png'];
}
