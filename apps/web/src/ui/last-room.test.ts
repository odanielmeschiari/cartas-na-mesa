import { describe, expect, it } from 'vitest';

import type { KeyValueStorage } from '../client/session-store';
import { createLastRoomStore } from './last-room';

/**
 * Dublê de `KeyValueStorage` em memória. Substitui o `localStorage` para
 * que o teste não dependa do navegador nem do ambiente.
 */
class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  /** Conteúdo bruto, para simular dado corrompido no storage. */
  raw(key: string): string | undefined {
    return this.entries.get(key);
  }
}

const LAST_ROOM_KEY = 'cnm:last-room';

describe('createLastRoomStore', () => {
  it('devolve null quando nada foi guardado', () => {
    const store = createLastRoomStore(new MemoryStorage());

    expect(store.load()).toBeNull();
  });

  it('faz ida e volta do código da sala', () => {
    const store = createLastRoomStore(new MemoryStorage());

    store.save('ABC123');

    expect(store.load()).toBe('ABC123');
  });

  it('normaliza o código com trim', () => {
    const store = createLastRoomStore(new MemoryStorage());

    store.save('  ABC123  ');

    expect(store.load()).toBe('ABC123');
  });

  it('não guarda código vazio', () => {
    const storage = new MemoryStorage();
    const store = createLastRoomStore(storage);

    store.save('   ');

    expect(store.load()).toBeNull();
    expect(storage.raw(LAST_ROOM_KEY)).toBeUndefined();
  });

  it('descarta código corrompido guardado no storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_ROOM_KEY, '   ');
    const store = createLastRoomStore(storage);

    expect(store.load()).toBeNull();
    expect(storage.raw(LAST_ROOM_KEY)).toBeUndefined();
  });

  it('apaga o código guardado', () => {
    const storage = new MemoryStorage();
    const store = createLastRoomStore(storage);

    store.save('ABC123');
    store.clear();

    expect(store.load()).toBeNull();
    expect(storage.raw(LAST_ROOM_KEY)).toBeUndefined();
  });

  it('sobrescreve o código anterior', () => {
    const store = createLastRoomStore(new MemoryStorage());

    store.save('ABC123');
    store.save('XYZ789');

    expect(store.load()).toBe('XYZ789');
  });

  it('degrada para "sem sala guardada" quando o storage falha', () => {
    const storage = new MemoryStorage();
    storage.getItem = () => {
      throw new Error('storage indisponível');
    };
    const store = createLastRoomStore(storage);

    expect(store.load()).toBeNull();
  });
});

describe('validade da sala salva', () => {
  it('esquece a sala depois do prazo e mantém antes dele', () => {
    let clock = 1_000;
    const store = createLastRoomStore(new MemoryStorage(), { now: () => clock, ttlMs: 500 });
    store.save('ABC123');
    clock = 1_400;
    expect(store.load()).toBe('ABC123');
    clock = 1_600;
    expect(store.load()).toBeNull();
    expect(store.load()).toBeNull();
  });
});
