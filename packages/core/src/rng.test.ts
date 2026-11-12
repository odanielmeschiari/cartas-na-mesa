import { describe, expect, it } from 'vitest';

import { createSeededRng, shuffle } from './rng';

const CARDS = ['c1', 'c2', 'c3', 'c4'] as const;

describe('createSeededRng', () => {
  it('reproduz uma sequência conhecida para a seed 42', () => {
    const rng = createSeededRng(42);
    expect(Array.from({ length: 8 }, () => rng.nextUint32())).toEqual([
      2581720956, 1925393290, 3661312704, 2876485805, 750819978, 2261697747, 1173505300, 2683257857,
    ]);
  });

  it('produz a mesma sequência para a mesma seed e instâncias independentes', () => {
    const firstRng = createSeededRng(7);
    const secondRng = createSeededRng(7);
    const first = Array.from({ length: 8 }, () => firstRng.nextUint32());
    const second = Array.from({ length: 8 }, () => secondRng.nextUint32());
    expect(first).toEqual(second);
  });

  it('produz sequências diferentes para seeds diferentes', () => {
    const first = createSeededRng(1);
    const second = createSeededRng(2);
    expect(first.nextUint32()).not.toBe(second.nextUint32());
  });

  it('retorna apenas inteiros de 32 bits sem sinal', () => {
    const rng = createSeededRng(123456);
    for (let index = 0; index < 100; index += 1) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('shuffle', () => {
  it('é determinístico para a mesma seed', () => {
    expect(shuffle(CARDS, createSeededRng(42))).toEqual(shuffle(CARDS, createSeededRng(42)));
  });

  it('preserva uma permutação e não muta a entrada', () => {
    const input = [...CARDS];
    const result = shuffle(input, createSeededRng(1));

    expect(input).toEqual([...CARDS]);
    expect(result).toEqual(['c3', 'c2', 'c1', 'c4']);
    expect([...result].sort()).toEqual([...CARDS].sort());
  });

  it('consome apenas o Rng injetado', () => {
    const rng = { nextUint32: () => 0 };
    expect(shuffle(CARDS, rng)).toEqual(['c2', 'c3', 'c4', 'c1']);
  });
});
