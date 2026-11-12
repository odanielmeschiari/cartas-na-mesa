import type { PrivateStateDescription } from '../ui/presentation';

/**
 * Visão privada: as cartas da própria mão.
 *
 * Cada carta é um `<button>`, jogável por teclado, com nome acessível que
 * diz **qual** carta é ("Jogar a carta 1 (c1)"). O `cardId` é opaco, então a
 * carta também tem um rótulo visível ("Carta 1") que não depende de saber ler
 * o identificador.
 *
 * O botão fica desabilitado quando o servidor não listou a jogada entre as
 * ações legais: a decisão é do servidor (regra 9), a UI só a reflete.
 */
export interface HandListProps {
  readonly hand: PrivateStateDescription | null;
  readonly onPlayCard: (cardId: string) => void;
}

export function HandList({ hand, onPlayCard }: HandListProps) {
  if (hand === null) {
    return <p className="text-sm text-stone-700">Sua mão ainda não chegou.</p>;
  }

  if (hand.isEmpty) {
    return <p className="text-sm text-stone-700">{hand.emptyLabel}</p>;
  }

  return (
    <ul className="flex flex-wrap gap-3">
      {hand.cards.map((card) => (
        <li key={card.cardId}>
          <button
            aria-label={card.accessibleName}
            className="cnm-hand-card"
            disabled={!card.playable}
            onClick={() => onPlayCard(card.cardId)}
            type="button"
          >
            <span aria-hidden="true" className="text-lg font-bold">
              {card.label}
            </span>
            <span aria-hidden="true" className="text-xs text-stone-700">
              {card.cardId}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
