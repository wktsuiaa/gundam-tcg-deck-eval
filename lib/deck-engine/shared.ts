import { type CardSynergyProfile } from '@/lib/effect-parser';

export const EMPTY_SYNERGY: CardSynergyProfile = { requires: [], enables: [] };

export const MAIN_DECK_TYPES = new Set(['UNIT', 'PILOT', 'COMMAND', 'BASE']);

export function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
