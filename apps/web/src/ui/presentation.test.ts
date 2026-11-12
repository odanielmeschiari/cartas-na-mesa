import { describe, expect, it } from 'vitest';

import type { FixturePrivateView, FixturePublicView, SeatInfo } from '@cartas-na-mesa/protocol';

import type { SpikeClientSnapshot, SpikeClientStatus } from '../client/spike-client';
import {
  describeAvatar,
  describeConnection,
  describeHandSize,
  describePrivateState,
  describePublicState,
  describeResult,
  describeSnapshot,
  describeTableCard,
  describeTurn,
  formatRoomCode,
} from './presentation';

/** Assento de teste. */
function seat(overrides: Partial<SeatInfo> = {}): SeatInfo {
  return {
    playerId: 'p1',
    seatIndex: 0,
    nickname: 'Ana',
    avatarId: null,
    connected: true,
    ...overrides,
  };
}

/** Estado público de teste. */
function publicGame(overrides: Partial<FixturePublicView> = {}): FixturePublicView {
  return {
    gameId: 'fixture',
    status: 'playing',
    currentTurnPlayerId: 'p1',
    handSizes: [
      { playerId: 'p1', count: 2 },
      { playerId: 'p2', count: 2 },
    ],
    table: [],
    result: null,
    ...overrides,
  };
}

/** Visão privada de teste. */
function privateView(overrides: Partial<FixturePrivateView> = {}): FixturePrivateView {
  return {
    playerId: 'p1',
    hand: ['c1', 'c3'],
    legalActions: [
      { type: 'play_card', cardId: 'c1' },
      { type: 'play_card', cardId: 'c3' },
    ],
    ...overrides,
  };
}

/** Snapshot de teste. */
function buildSnapshot(
  options: {
    readonly status?: SpikeClientStatus;
    readonly seats?: readonly SeatInfo[];
    readonly publicGame?: FixturePublicView | null;
    readonly privateView?: FixturePrivateView | null;
    readonly lastError?: SpikeClientSnapshot['lastError'];
  } = {},
): SpikeClientSnapshot {
  return {
    status: options.status ?? 'playing',
    roomCode: 'ABC123',
    matchId: 'match-1',
    version: 3,
    seats: options.seats ?? [seat(), seat({ playerId: 'p2', seatIndex: 1, nickname: 'Bruno' })],
    // `in` (e não `??`) para distinguir "não informado" de "informado como null":
    // o snapshot sem partida tem `publicGame` e `privateView` nulos de verdade.
    publicGame: 'publicGame' in options ? options.publicGame : publicGame(),
    privateView: 'privateView' in options ? options.privateView : privateView(),
    events: [],
    lastError: options.lastError ?? null,
  };
}

describe('formatRoomCode', () => {
  it('remove espaços das pontas e normaliza para maiúsculas', () => {
    expect(formatRoomCode('  abc123 ')).toBe('ABC123');
  });

  it('devolve string vazia para entrada vazia', () => {
    expect(formatRoomCode('   ')).toBe('');
  });
});

describe('describeAvatar', () => {
  it('nomeia o avatar padrão quando não há avatar', () => {
    expect(describeAvatar(null)).toBe('avatar padrão');
  });

  it('nomeia o avatar escolhido', () => {
    expect(describeAvatar('cat.png')).toBe('avatar cat.png');
  });
});

describe('describeConnection', () => {
  it('descreve cada estado da conexão', () => {
    expect(describeConnection('connecting')).toBe('Conectando ao servidor…');
    expect(describeConnection('waiting')).toBe('Aguardando o segundo jogador.');
    expect(describeConnection('playing')).toBe('Partida em andamento.');
    expect(describeConnection('reconnecting')).toBe('A conexão caiu. Reconectando…');
    expect(describeConnection('error')).toBe('A conexão com o servidor foi encerrada.');
  });
});

describe('describeTurn', () => {
  it('nomeia quem tem o turno', () => {
    expect(describeTurn('p1', () => 'Ana')).toBe('É o turno de Ana.');
  });

  it('diz que não há turno ativo quando não há', () => {
    expect(describeTurn(null, () => 'Ana')).toBe('Nenhum turno ativo.');
  });
});

describe('describeResult', () => {
  it('não devolve texto enquanto a partida não termina', () => {
    expect(describeResult(null)).toBeNull();
  });

  it('nomeia o empate do fixture', () => {
    expect(describeResult({ outcome: 'draw' })).toBe('Resultado: empate.');
  });
});

describe('describeHandSize', () => {
  it('pluraliza o número de cartas', () => {
    expect(describeHandSize('Ana', 1).label).toBe('1 carta');
    expect(describeHandSize('Ana', 2).label).toBe('2 cartas');
    expect(describeHandSize('Ana', 0).label).toBe('0 cartas');
  });
});

describe('describeTableCard', () => {
  it('nomeia quem jogou a carta', () => {
    expect(describeTableCard('Ana', 'c2').label).toBe('Ana jogou a carta c2');
  });
});

describe('describePublicState', () => {
  it('descreve status, turno, mãos, mesa e resultado', () => {
    const description = describePublicState(
      publicGame({
        table: [{ playerId: 'p2', cardId: 'c4' }],
        result: { outcome: 'draw' },
      }),
      (playerId) => (playerId === 'p1' ? 'Ana' : 'Bruno'),
    );

    expect(description.statusLabel).toBe('Em andamento');
    expect(description.turnLabel).toBe('É o turno de Ana.');
    expect(description.handSizes).toEqual([
      { nickname: 'Ana', count: 2, label: '2 cartas' },
      { nickname: 'Bruno', count: 2, label: '2 cartas' },
    ]);
    expect(description.table).toEqual([
      { nickname: 'Bruno', cardId: 'c4', label: 'Bruno jogou a carta c4' },
    ]);
    expect(description.resultLabel).toBe('Resultado: empate.');
  });

  it('marca a partida como encerrada', () => {
    const description = describePublicState(
      publicGame({ status: 'finished', currentTurnPlayerId: null }),
      () => 'Ana',
    );

    expect(description.statusLabel).toBe('Encerrada');
    expect(description.turnLabel).toBe('Nenhum turno ativo.');
  });

  it('nomeia jogador desconhecido em vez de falhar', () => {
    const description = describePublicState(
      publicGame({ currentTurnPlayerId: 'p9' }),
      () => 'Jogador desconhecido',
    );

    expect(description.turnLabel).toBe('É o turno de Jogador desconhecido.');
  });
});

describe('describePrivateState', () => {
  it('descreve as cartas da mão com rótulo e nome acessível', () => {
    const description = describePrivateState(privateView());

    expect(description.isEmpty).toBe(false);
    expect(description.cards).toEqual([
      {
        cardId: 'c1',
        label: 'Carta 1',
        accessibleName: 'Jogar a carta 1 (c1)',
        playable: true,
      },
      {
        cardId: 'c3',
        label: 'Carta 2',
        accessibleName: 'Jogar a carta 2 (c3)',
        playable: true,
      },
    ]);
  });

  it('marca como não jogável a carta que o servidor não listou', () => {
    const description = describePrivateState(
      privateView({ legalActions: [{ type: 'play_card', cardId: 'c1' }] }),
    );

    expect(description.cards[0]?.playable).toBe(true);
    expect(description.cards[1]?.playable).toBe(false);
  });

  it('trata a mão vazia', () => {
    const description = describePrivateState(privateView({ hand: [], legalActions: [] }));

    expect(description.isEmpty).toBe(true);
    expect(description.cards).toEqual([]);
    expect(description.emptyLabel).toBe('Sua mão está vazia.');
  });
});

describe('describeSnapshot', () => {
  it('descreve a sala inteira', () => {
    const description = describeSnapshot(buildSnapshot());

    expect(description.roomCode).toBe('ABC123');
    expect(description.matchId).toBe('match-1');
    expect(description.connectionLabel).toBe('Partida em andamento.');
    expect(description.seats.map((entry) => entry.nickname)).toEqual(['Ana', 'Bruno']);
    expect(description.publicState?.turnLabel).toBe('É o turno de Ana.');
    expect(description.privateState?.cards).toHaveLength(2);
  });

  it('marca a presença e o turno por texto, sem depender de cor', () => {
    const description = describeSnapshot(
      buildSnapshot({
        seats: [
          seat(),
          seat({ playerId: 'p2', seatIndex: 1, nickname: 'Bruno', connected: false }),
        ],
        publicGame: publicGame({ currentTurnPlayerId: 'p2' }),
      }),
    );

    expect(description.seats[0]?.presenceLabel).toBe('presente');
    expect(description.seats[0]?.turnLabel).toBeNull();
    expect(description.seats[1]?.presenceLabel).toBe('ausente');
    expect(description.seats[1]?.turnLabel).toBe('é o turno de Bruno');
  });

  it('trata o snapshot sem partida iniciada', () => {
    const description = describeSnapshot(
      buildSnapshot({ status: 'waiting', publicGame: null, privateView: null }),
    );

    expect(description.connectionLabel).toBe('Aguardando o segundo jogador.');
    expect(description.publicState).toBeNull();
    expect(description.privateState).toBeNull();
    expect(description.seats[0]?.handCount).toBeNull();
  });

  it('informa o tamanho da mão de cada assento', () => {
    const description = describeSnapshot(buildSnapshot());

    expect(description.seats[0]?.handCount).toBe(2);
    expect(description.seats[1]?.handCount).toBe(2);
  });
});
