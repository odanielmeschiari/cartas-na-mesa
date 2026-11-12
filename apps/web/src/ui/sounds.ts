import drawUrl from '../assets/sounds/comprar-carta.mp3';
import moveUrl from '../assets/sounds/mover-carta.mp3';
import shuffleUrl from '../assets/sounds/shuffle.mp3';

/**
 * Efeitos sonoros do jogo.
 *
 * - `shuffle`: embaralhamento (o arquivo já tem 1 segundo).
 * - `draw`: uma carta distribuída ou comprada do monte.
 * - `move`: uma carta trocada de lugar ou baixada na mesa.
 *
 * Os sons são decodificados uma vez (Web Audio) e tocados na hora, sem o
 * atraso do `<audio>`. Os arquivos têm ~0,1 s de silêncio no começo; esse
 * trecho é medido na decodificação e pulado, para o som sair junto com o gesto.
 */
export type SoundName = 'shuffle' | 'draw' | 'move';

const URLS: Record<SoundName, string> = { shuffle: shuffleUrl, draw: drawUrl, move: moveUrl };
const VOLUME: Record<SoundName, number> = { shuffle: 0.7, draw: 0.8, move: 0.8 };
const MUTE_KEY = 'cnm:muted';
const SILENCE_THRESHOLD = 0.01;
const SAFETY_MARGIN_S = 0.002;

type LoadedSound = { readonly buffer: AudioBuffer; readonly offset: number };

let context: AudioContext | null = null;
const loaded = new Map<SoundName, LoadedSound>();
const loading = new Set<SoundName>();
const fallbacks = new Map<SoundName, HTMLAudioElement>();
let unlockInstalled = false;
let lastShuffleAt = 0;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Sem storage: o silêncio vale só nesta sessão.
  }
}

function getContext(): AudioContext | null {
  if (context !== null) return context;
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) return null;
  try {
    context = new Ctor({ latencyHint: 'interactive' });
  } catch {
    context = null;
  }
  return context;
}

/** Segundos de silêncio no início do áudio (primeira amostra audível). */
function leadingSilence(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    if (Math.abs(data[i] ?? 0) > SILENCE_THRESHOLD) {
      return Math.max(0, i / buffer.sampleRate - SAFETY_MARGIN_S);
    }
  }
  return 0;
}

async function load(name: SoundName, ctx: AudioContext): Promise<void> {
  if (loaded.has(name) || loading.has(name)) return;
  loading.add(name);
  try {
    const response = await fetch(URLS[name]);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    loaded.set(name, { buffer, offset: leadingSilence(buffer) });
  } catch {
    // Sem decodificação: `playSound` cai no <audio> comum.
  } finally {
    loading.delete(name);
  }
}

/** Navegadores só liberam áudio depois de um gesto do usuário. */
function installUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const unlock = (): void => {
    if (context !== null && context.state === 'suspended') void context.resume();
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(type, unlock, { passive: true });
  }
}

/** Baixa e decodifica os sons antes do primeiro uso. */
export function preloadSounds(): void {
  if (typeof window === 'undefined') return;
  installUnlock();
  const ctx = getContext();
  for (const name of Object.keys(URLS) as SoundName[]) {
    if (ctx !== null) void load(name, ctx);
    if (!fallbacks.has(name) && typeof Audio !== 'undefined') {
      const audio = new Audio(URLS[name]);
      audio.preload = 'auto';
      fallbacks.set(name, audio);
    }
  }
}

/**
 * Toca um efeito. Cada chamada cria uma fonte nova, então vários sons podem
 * se sobrepor (distribuição rápida). Falhas são silenciosas: som nunca
 * quebra o jogo.
 */
export function playSound(name: SoundName): void {
  if (muted) return;
  if (name === 'shuffle') {
    // Evita som duplicado quando o React remonta o componente em desenvolvimento.
    const now = Date.now();
    if (now - lastShuffleAt < 300) return;
    lastShuffleAt = now;
  }
  preloadSounds();

  const ctx = context;
  const sound = loaded.get(name);
  if (ctx !== null && sound !== undefined) {
    if (ctx.state === 'suspended') void ctx.resume();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = sound.buffer;
    gain.gain.value = VOLUME[name];
    source.connect(gain).connect(ctx.destination);
    source.start(0, sound.offset);
    return;
  }

  // Ainda decodificando (ou sem Web Audio): <audio> comum.
  const template = fallbacks.get(name);
  if (template === undefined) return;
  const audio = template.cloneNode(true) as HTMLAudioElement;
  audio.volume = VOLUME[name];
  audio.play()?.catch(() => undefined);
}
