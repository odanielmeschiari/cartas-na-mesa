import { describe, expect, it } from 'vitest';

import { createSessionStore, type KeyValueStorage } from './session-store';

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

const IDENTITY_KEY = 'cnm:identity';
const SESSION_TOKEN_KEY = 'cnm:session:ABC123';

describe('createSessionStore', () => {
  it('devolve null quando nada foi guardado', () => {
    const store = createSessionStore(new MemoryStorage());

    expect(store.loadIdentity()).toBeNull();
    expect(store.loadSessionToken('ABC123')).toBeNull();
  });

  it('faz ida e volta da identidade', () => {
    const store = createSessionStore(new MemoryStorage());

    store.saveIdentity({ nickname: 'Ana', avatarId: 'cat.png' });

    expect(store.loadIdentity()).toEqual({ nickname: 'Ana', avatarId: 'cat.png' });
  });

  it('faz ida e volta do token de sessão, por sala', () => {
    const store = createSessionStore(new MemoryStorage());

    store.saveSessionToken('ABC123', 'token-abc');
    store.saveSessionToken('XYZ789', 'token-xyz');

    expect(store.loadSessionToken('ABC123')).toBe('token-abc');
    expect(store.loadSessionToken('XYZ789')).toBe('token-xyz');
  });

  it('normaliza o apelido com trim e limita em 24 caracteres', () => {
    const store = createSessionStore(new MemoryStorage());

    store.saveIdentity({ nickname: '   Ana Maria   ', avatarId: null });

    expect(store.loadIdentity()?.nickname).toBe('Ana Maria');

    store.saveIdentity({ nickname: 'x'.repeat(40), avatarId: null });

    expect(store.loadIdentity()?.nickname).toHaveLength(24);
  });

  it('normaliza avatar vazio para null', () => {
    const store = createSessionStore(new MemoryStorage());

    store.saveIdentity({ nickname: 'Ana', avatarId: '' });

    expect(store.loadIdentity()).toEqual({ nickname: 'Ana', avatarId: null });
  });

  it('não guarda identidade sem apelido válido', () => {
    const storage = new MemoryStorage();
    const store = createSessionStore(storage);

    store.saveIdentity({ nickname: '   ', avatarId: null });

    expect(store.loadIdentity()).toBeNull();
    expect(storage.raw(IDENTITY_KEY)).toBeUndefined();
  });

  it('descarta identidade com apelido fora do limite', () => {
    const storage = new MemoryStorage();
    storage.setItem(IDENTITY_KEY, JSON.stringify({ nickname: '', avatarId: null }));
    const store = createSessionStore(storage);

    expect(store.loadIdentity()).toBeNull();
    expect(storage.raw(IDENTITY_KEY)).toBeUndefined();
  });

  it('descarta identidade com apelado longo demais', () => {
    const storage = new MemoryStorage();
    storage.setItem(IDENTITY_KEY, JSON.stringify({ nickname: 'x'.repeat(25), avatarId: null }));
    const store = createSessionStore(storage);

    expect(store.loadIdentity()).toBeNull();
  });

  it('descarta identidade com avatar inválido', () => {
    const storage = new MemoryStorage();
    storage.setItem(IDENTITY_KEY, JSON.stringify({ nickname: 'Ana', avatarId: 42 }));
    const store = createSessionStore(storage);

    expect(store.loadIdentity()).toBeNull();
    expect(storage.raw(IDENTITY_KEY)).toBeUndefined();
  });

  it('descarta identidade com conteúdo corrompido', () => {
    const storage = new MemoryStorage();
    storage.setItem(IDENTITY_KEY, '{não é json');
    const store = createSessionStore(storage);

    expect(store.loadIdentity()).toBeNull();
    expect(storage.raw(IDENTITY_KEY)).toBeUndefined();
  });

  it('descarta token de sessão vazio', () => {
    const storage = new MemoryStorage();
    storage.setItem(SESSION_TOKEN_KEY, '   ');
    const store = createSessionStore(storage);

    expect(store.loadSessionToken('ABC123')).toBeNull();
    expect(storage.raw(SESSION_TOKEN_KEY)).toBeUndefined();
  });

  it('não guarda token de sessão vazio', () => {
    const storage = new MemoryStorage();
    const store = createSessionStore(storage);

    store.saveSessionToken('ABC123', '');

    expect(store.loadSessionToken('ABC123')).toBeNull();
    expect(storage.raw(SESSION_TOKEN_KEY)).toBeUndefined();
  });

  it('apaga o token de sessão da sala', () => {
    const storage = new MemoryStorage();
    const store = createSessionStore(storage);

    store.saveSessionToken('ABC123', 'token-abc');
    store.saveSessionToken('XYZ789', 'token-xyz');
    store.clearSessionToken('ABC123');

    expect(store.loadSessionToken('ABC123')).toBeNull();
    expect(store.loadSessionToken('XYZ789')).toBe('token-xyz');
  });
});
