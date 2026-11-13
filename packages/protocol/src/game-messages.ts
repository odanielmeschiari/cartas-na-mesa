import { z } from 'zod';

import { actionIntentMessageSchema } from './client-messages';
import {
  heartsActionPayloadSchema,
  heartsEventSchema,
  heartsPrivateViewSchema,
  heartsPublicViewSchema,
} from './hearts';
import {
  eventsMessageSchema,
  statePrivateMessageSchema,
  statePublicMessageSchema,
} from './server-messages';

// ADR-002: o envelope das mensagens é o mesmo para todos os jogos; só os campos de jogo
// (`action`, `game`, `view`, `events`) mudam. Os schemas sem prefixo em server-messages.ts e
// client-messages.ts continuam sendo os do fixture, para os consumidores que só falam com ele.
// Aqui ficam as instâncias do Copas e as uniões que a borda genérica aceita.
//
// A união é `z.union`, e não `discriminatedUnion`: `play_card` e `card_played` existem nos dois
// jogos. Quem hospeda um jogo revalida o campo com o schema do próprio jogo (ADR-002, item 2).

export const heartsActionIntentMessageSchema = actionIntentMessageSchema.extend({
  action: heartsActionPayloadSchema,
});

export const heartsStatePublicMessageSchema = statePublicMessageSchema.extend({
  game: heartsPublicViewSchema,
});

export const heartsStatePrivateMessageSchema = statePrivateMessageSchema.extend({
  view: heartsPrivateViewSchema,
});

export const heartsEventsMessageSchema = eventsMessageSchema.extend({
  events: z.array(heartsEventSchema),
});

export const anyGameActionIntentMessageSchema = z.union([
  actionIntentMessageSchema,
  heartsActionIntentMessageSchema,
]);

export const anyGameStatePublicMessageSchema = z.union([
  statePublicMessageSchema,
  heartsStatePublicMessageSchema,
]);

export const anyGameStatePrivateMessageSchema = z.union([
  statePrivateMessageSchema,
  heartsStatePrivateMessageSchema,
]);

export const anyGameEventsMessageSchema = z.union([
  eventsMessageSchema,
  heartsEventsMessageSchema,
]);

export type HeartsActionIntentMessage = z.infer<typeof heartsActionIntentMessageSchema>;
export type HeartsStatePublicMessage = z.infer<typeof heartsStatePublicMessageSchema>;
export type HeartsStatePrivateMessage = z.infer<typeof heartsStatePrivateMessageSchema>;
export type HeartsEventsMessage = z.infer<typeof heartsEventsMessageSchema>;
export type AnyGameActionIntentMessage = z.infer<typeof anyGameActionIntentMessageSchema>;
export type AnyGameStatePublicMessage = z.infer<typeof anyGameStatePublicMessageSchema>;
export type AnyGameStatePrivateMessage = z.infer<typeof anyGameStatePrivateMessageSchema>;
export type AnyGameEventsMessage = z.infer<typeof anyGameEventsMessageSchema>;
