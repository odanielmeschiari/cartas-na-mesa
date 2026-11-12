// Contrato de aleatoriedade de docs/architecture/0001-fixture-contract.md §3.
// Toda aleatoriedade do domínio é injetada por esta interface; não há fonte global.
export interface Rng {
  nextUint32(): number;
}

const UINT32_RANGE = 0x1_0000_0000;

/**
 * mulberry32: PRNG de 32 bits cujo único estado vive no closure da instância.
 * Mesma seed produz a mesma sequência; instâncias diferentes não se afetam.
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    nextUint32(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (value ^ (value >>> 14)) >>> 0;
    },
  };
}

function nextUint32(rng: Rng): number {
  const value = rng.nextUint32();
  if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
    throw new RangeError('Rng.nextUint32() deve retornar um inteiro de 32 bits sem sinal.');
  }
  return value;
}

// Sorteio por rejeição: elimina o viés que o operador de módulo introduziria.
function nextIndex(rng: Rng, bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError('bound deve ser um inteiro positivo.');
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % bound);
  let value = nextUint32(rng);
  while (value >= limit) {
    value = nextUint32(rng);
  }
  return value % bound;
}

/**
 * Fisher–Yates puro sobre uma cópia: não altera `items` e consome apenas o `Rng` recebido.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = nextIndex(rng, i + 1);
    const left = result[i];
    const right = result[j];
    if (left === undefined || right === undefined) {
      throw new Error('shuffle gerou índice fora do intervalo.');
    }
    result[i] = right;
    result[j] = left;
  }
  return result;
}
