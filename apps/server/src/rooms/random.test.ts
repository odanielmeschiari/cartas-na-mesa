import { shuffle } from '@cartas-na-mesa/core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROOM_CODE_LENGTH,
  MAX_ROOM_CODE_LENGTH,
  MIN_ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  SESSION_TOKEN_BYTES,
  createCryptoRng,
  cryptoRandomBytes,
  randomRoomCode,
  randomSessionToken,
  randomUint32,
  type RandomSource,
} from './random';

/**
 * Fonte que devolve sempre os mesmos bytes (ciclando se pedirem mais do que
 * o que foi informado). Determinística e sem estado: duas chamadas com a mesma
 * fonte devolvem exatamente o mesmo buffer.
 */
function fixedSource(bytes: readonly number[]): RandomSource {
  return (length: number) => {
    const result = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      const value = bytes[index % bytes.length];
      if (value === undefined) {
        throw new Error('Fonte de teste sem bytes.');
      }
      result[index] = value;
    }
    return result;
  };
}

/**
 * Fonte que percorre a lista de bytes a cada byte consumido. Serve para
 * observar quantos bytes o sorteio realmente consumiu.
 */
function sequenceSource(bytes: readonly number[]): RandomSource {
  let cursor = 0;
  return (length: number) => {
    const result = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      const value = bytes[cursor % bytes.length];
      cursor += 1;
      if (value === undefined) {
        throw new Error('Fonte de teste sem bytes.');
      }
      result[index] = value;
    }
    return result;
  };
}

describe('cryptoRandomBytes', () => {
  it('devolve exatamente o número de bytes pedido', () => {
    expect(cryptoRandomBytes(0).length).toBe(0);
    expect(cryptoRandomBytes(1).length).toBe(1);
    expect(cryptoRandomBytes(32).length).toBe(32);
  });

  it('devolve buffers diferentes em duas chamadas consecutivas', () => {
    // 32 bytes = 256 bits: a probabilidade de colisão é 2^-256, desprezível.
    const first = cryptoRandomBytes(32);
    const second = cryptoRandomBytes(32);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it('rejeita comprimento que não é inteiro não negativo', () => {
    expect(() => cryptoRandomBytes(-1)).toThrow(RangeError);
    expect(() => cryptoRandomBytes(1.5)).toThrow(RangeError);
    expect(() => cryptoRandomBytes(Number.NaN)).toThrow(RangeError);
  });
});

describe('randomRoomCode', () => {
  it('produz o resultado esperado para uma fonte determinística conhecida', () => {
    // Bytes 0..5 caem nas seis primeiras posições do alfabeto: A, B, C, D, E, F.
    expect(randomRoomCode(DEFAULT_ROOM_CODE_LENGTH, sequenceSource([0, 1, 2, 3, 4, 5]))).toBe(
      'ABCDEF',
    );
    // Último e primeiro símbolos do alfabeto, para fixar a ordem de mapeamento.
    expect(randomRoomCode(3, sequenceSource([31, 24, 23]))).toBe('92Z');
  });

  it('devolve o comprimento pedido com caracteres do alfabeto permitido', () => {
    // Índices 0, 7, 8, 13, 23, 24, 30 e 31 do alfabeto: A, H, J, P, Z, 2, 8, 9.
    const code = randomRoomCode(8, sequenceSource([0, 7, 8, 13, 23, 24, 30, 31]));
    expect(code).toHaveLength(8);
    for (const character of code) {
      expect(ROOM_CODE_ALPHABET).toContain(character);
    }
    expect(code).toBe('AHJPZ289');
  });

  it('usa o comprimento padrão quando nenhum é informado', () => {
    expect(randomRoomCode(undefined, sequenceSource([0, 1, 2, 3, 4, 5]))).toHaveLength(
      DEFAULT_ROOM_CODE_LENGTH,
    );
  });

  it('rejeita bytes fora da faixa e não os usa como caracteres', () => {
    // A fonte entrega 224 (fora da janela de aceitação) e depois 5.
    // Um sorteio com viés de módulo usaria 224 % 32 = 0 e produziria 'A'.
    let calls = 0;
    const inner = sequenceSource([224, 5]);
    const source: RandomSource = (length: number) => {
      calls += 1;
      return inner(length);
    };

    const code = randomRoomCode(2, source);

    expect(code).toBe('FF');
    expect(code).not.toContain('A');
    // Cada caractere consumiu um byte rejeitado e um aceito: 4 chamadas à fonte.
    expect(calls).toBe(4);
  });

  it('rejeita comprimento fora da faixa de 1 a 12', () => {
    expect(() => randomRoomCode(MIN_ROOM_CODE_LENGTH - 1)).toThrow(RangeError);
    expect(() => randomRoomCode(MAX_ROOM_CODE_LENGTH + 1)).toThrow(RangeError);
    expect(() => randomRoomCode(-1)).toThrow(RangeError);
    expect(() => randomRoomCode(2.5)).toThrow(RangeError);
    expect(() => randomRoomCode(Number.NaN)).toThrow(RangeError);
  });

  it('valida o comprimento antes de consumir aleatoriedade', () => {
    const source: RandomSource = () => {
      throw new Error('A fonte não deveria ser chamada.');
    };
    expect(() => randomRoomCode(0, source)).toThrow(RangeError);
  });

  it('aceita os extremos da faixa de comprimento', () => {
    expect(randomRoomCode(MIN_ROOM_CODE_LENGTH, fixedSource([0]))).toHaveLength(
      MIN_ROOM_CODE_LENGTH,
    );
    expect(
      randomRoomCode(MAX_ROOM_CODE_LENGTH, fixedSource(Array.from({ length: 12 }, () => 0))),
    ).toHaveLength(MAX_ROOM_CODE_LENGTH);
  });

  it('falha de forma explícita quando a fonte devolve bytes demais', () => {
    const source: RandomSource = (length: number) => new Uint8Array(length + 1);
    expect(() => randomRoomCode(1, source)).toThrow(/bytes/);
  });
});

describe('randomUint32', () => {
  it('monta o valor a partir de 4 bytes big-endian', () => {
    expect(randomUint32(fixedSource([0, 0, 0, 0]))).toBe(0);
    expect(randomUint32(fixedSource([0, 0, 0, 1]))).toBe(1);
    expect(randomUint32(fixedSource([1, 0, 0, 0]))).toBe(16_777_216);
    expect(randomUint32(fixedSource([255, 255, 255, 255]))).toBe(4_294_967_295);
  });

  it('devolve sempre um inteiro de 32 bits sem sinal', () => {
    const sources: RandomSource[] = [
      cryptoRandomBytes,
      fixedSource([0, 0, 0, 0]),
      fixedSource([255, 255, 255, 255]),
      fixedSource([17, 34, 51, 68]),
    ];
    for (const source of sources) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const value = randomUint32(source);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(0x1_0000_0000);
      }
    }
  });

  it('usa o CSPRNG quando nenhuma fonte é informada', () => {
    const value = randomUint32();
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(0x1_0000_0000);
  });
});

describe('randomSessionToken', () => {
  it('devolve um token opaco com o comprimento coerente com os bytes pedidos', () => {
    const token = randomSessionToken(
      fixedSource(Array.from({ length: SESSION_TOKEN_BYTES }, () => 0)),
    );
    // 32 bytes = 256 bits; base64url sem padding ocupa 43 caracteres.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('é determinístico para a mesma fonte', () => {
    const source = fixedSource(Array.from({ length: SESSION_TOKEN_BYTES }, () => 7));
    expect(randomSessionToken(source)).toBe(randomSessionToken(source));
  });

  it('produz tokens diferentes para fontes diferentes', () => {
    const first = randomSessionToken(
      fixedSource(Array.from({ length: SESSION_TOKEN_BYTES }, () => 1)),
    );
    const second = randomSessionToken(
      fixedSource(Array.from({ length: SESSION_TOKEN_BYTES }, () => 2)),
    );
    expect(first).not.toBe(second);
  });

  it('usa o CSPRNG quando nenhuma fonte é informada', () => {
    const token = randomSessionToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('createCryptoRng', () => {
  it('consome 4 bytes novos da fonte a cada chamada', () => {
    const rng = createCryptoRng(sequenceSource([0, 0, 0, 1, 0, 0, 1, 0]));
    expect(rng.nextUint32()).toBe(1);
    expect(rng.nextUint32()).toBe(256);
  });

  it('não guarda estado: duas instâncias sobre a mesma fonte fixa coincidem', () => {
    const first = createCryptoRng(fixedSource([1, 2, 3, 4]));
    const second = createCryptoRng(fixedSource([1, 2, 3, 4]));
    expect(first.nextUint32()).toBe(second.nextUint32());
    expect(first.nextUint32()).toBe(0x01020304);
  });

  it('usa o CSPRNG quando nenhuma fonte é informada', () => {
    const value = createCryptoRng().nextUint32();
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(0x1_0000_0000);
  });

  it('serve de Rng para o embaralhamento do core sem perder cartas', () => {
    const items = Array.from({ length: 52 }, (_, index) => index);
    const shuffled = shuffle(items, createCryptoRng());
    expect(shuffled).toHaveLength(52);
    expect([...shuffled].sort((left, right) => left - right)).toEqual(items);
  });
});
