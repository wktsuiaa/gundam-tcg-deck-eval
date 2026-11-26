import type { GundamCardPrint } from '@/types/gundam';
import { parseCardAbilities } from '../cfg-parser.ts';
import { parseCardEffects } from './clause-compile.ts';
import { extractEffectPrerequisites } from './prerequisites.ts';
import { extractSynergyProfile } from './synergy.ts';
import { type CompiledCardEffect } from './types.ts';

export function compileCardEffect(
  card: Pick<GundamCardPrint, 'cardNo' | 'printId' | 'name' | 'type' | 'color' | 'ap' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'traits' | 'link'>>
): CompiledCardEffect {
  const parsed = parseCardEffects(card);
  const cfg = parseCardAbilities(card, parsed.clauses);
  if (cfg.errors.length > 0) {
    throw new Error(`CFG parse failure for ${card.cardNo}: ${cfg.errors.join('; ')}`);
  }
  return {
    cardNo: card.cardNo,
    sourcePrintId: card.printId,
    name: card.name,
    type: card.type,
    color: card.color,
    keywords: cfg.keywords.length > 0 ? cfg.keywords : parsed.keywords,
    abilities: cfg.abilities,
    synergy: extractSynergyProfile(card, parsed),
    prerequisites: extractEffectPrerequisites(card, parsed),
  };
}
