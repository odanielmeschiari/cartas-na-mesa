import drawUrl from '../assets/sounds/comprar-carta.mp3';
import moveUrl from '../assets/sounds/mover-carta.mp3';
import shuffleUrl from '../assets/sounds/shuffle.mp3';

/**
 * Efeitos sonoros do jogo.
 *
 * - `shuffle`: embaralhamento (o arquivo já tem 1 segundo).
 * - `draw`: uma carta distribuída ou comprada do monte.
 * - `move`: uma carta trocada de lugar ou baixada na mesa.
 */
export type SoundName = 'shuffle' | 'draw' | 'move';

const URLS: Record<SoundName, string> = { shuffle: shuffleUrl, draw: drawUrl, move: moveUrl };
const VOLUME: Record<SoundName, number> = { shuffle: 0.7, draw: 0.8, move: 0.8 };
const MUTE_KEY = 'cnm:muted';

const templates = new Map<SoundName, HTMLAudioElement>();
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

/** Baixa os arquivos antes do primeiro uso, para o som não atrasar. */
export function preloadSounds(): void {
  if (typeof Audio === 'undefined') return;
  for (const name of Object.keys(URLS) as SoundName[]) {
    if (!templates.has(name)) {
      const audio = new Audio(URLS[name]);
      audio.preload = 'auto';
      templates.set(name, audio);
    }
  }
}

/**
 * Toca um efeito. Cada chamada usa uma cópia do áudio, então vários sons
 * podem se sobrepor (distribuição rápida de cartas). Falhas de reprodução
 * (política de autoplay, sem áudio) são silenciosas: som nunca quebra o jogo.
 */
export function playSound(name: SoundName): void {
  if (muted || typeof Audio === 'undefined') return;
  if (name === 'shuffle') {
    // Evita som duplicado quando o React remonta o componente em desenvolvimento.
    const now = Date.now();
    if (now - lastShuffleAt < 300) return;
    lastShuffleAt = now;
  }
  preloadSounds();
  const template = templates.get(name);
  if (template === undefined) return;

  const audio = template.cloneNode(true) as HTMLAudioElement;
  audio.volume = VOLUME[name];
  audio.play()?.catch(() => undefined);
}
