import { z } from 'zod';

// Códigos estáveis do contrato §5; invalid_setup do motor é mapeado para internal.
export const errorCodeSchema = z.enum([
  'invalid_payload',
  'room_not_found',
  'room_full',
  'session_invalid',
  'match_not_found',
  'stale_state',
  'not_your_turn',
  'card_not_in_hand',
  'game_finished',
  'internal',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;
