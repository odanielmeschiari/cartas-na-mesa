import { describe, expect, it } from 'vitest';

import {
  avatarIdSchema,
  cardIdSchema,
  matchIdSchema,
  nicknameSchema,
  playerIdSchema,
  roomCodeSchema,
  seatIndexSchema,
  sessionTokenSchema,
  stateVersionSchema,
} from './scalars';

describe('nicknameSchema', () => {
  it('normaliza o apelido com trim', () => {
    expect(nicknameSchema.parse('  Ana  ')).toBe('Ana');
  });

  it('rejeita apelido formado apenas por espaços', () => {
    expect(nicknameSchema.safeParse('   ').success).toBe(false);
  });

  it('rejeita apelido vazio', () => {
    expect(nicknameSchema.safeParse('').success).toBe(false);
  });

  it('aceita 24 caracteres após trim', () => {
    expect(nicknameSchema.safeParse(`  ${'a'.repeat(24)}  `).success).toBe(true);
  });

  it('rejeita 25 caracteres após trim', () => {
    expect(nicknameSchema.safeParse(`  ${'a'.repeat(25)}  `).success).toBe(false);
  });
});

describe('seatIndexSchema', () => {
  it('aceita inteiro não negativo', () => {
    expect(seatIndexSchema.safeParse(0).success).toBe(true);
    expect(seatIndexSchema.safeParse(1).success).toBe(true);
  });

  it('rejeita negativo, fracionário e texto', () => {
    expect(seatIndexSchema.safeParse(-1).success).toBe(false);
    expect(seatIndexSchema.safeParse(1.5).success).toBe(false);
    expect(seatIndexSchema.safeParse('0').success).toBe(false);
  });
});

describe('stateVersionSchema', () => {
  it('aceita inteiro não negativo', () => {
    expect(stateVersionSchema.safeParse(0).success).toBe(true);
    expect(stateVersionSchema.safeParse(42).success).toBe(true);
  });

  it('rejeita negativo, fracionário e texto', () => {
    expect(stateVersionSchema.safeParse(-1).success).toBe(false);
    expect(stateVersionSchema.safeParse(0.5).success).toBe(false);
    expect(stateVersionSchema.safeParse('1').success).toBe(false);
  });
});

describe('identificadores opacos', () => {
  it('rejeitam string vazia', () => {
    expect(roomCodeSchema.safeParse('').success).toBe(false);
    expect(matchIdSchema.safeParse('').success).toBe(false);
    expect(playerIdSchema.safeParse('').success).toBe(false);
    expect(cardIdSchema.safeParse('').success).toBe(false);
    expect(sessionTokenSchema.safeParse('').success).toBe(false);
  });

  it('aceitam string não vazia', () => {
    expect(roomCodeSchema.safeParse('ABCD').success).toBe(true);
    expect(matchIdSchema.safeParse('m1').success).toBe(true);
    expect(playerIdSchema.safeParse('p1').success).toBe(true);
    expect(cardIdSchema.safeParse('c1').success).toBe(true);
    expect(sessionTokenSchema.safeParse('token').success).toBe(true);
  });
});

describe('avatarIdSchema', () => {
  it('aceita avatar padrão (null) e identificador', () => {
    expect(avatarIdSchema.parse(null)).toBeNull();
    expect(avatarIdSchema.parse('avatar-1')).toBe('avatar-1');
  });

  it('rejeita ausência e tipo errado', () => {
    expect(avatarIdSchema.safeParse(undefined).success).toBe(false);
    expect(avatarIdSchema.safeParse(1).success).toBe(false);
  });
});
