import type { CardColor } from '@/types/gundam';
import { parseTargetSelector } from './selectors.ts';
import { type ActivationCost, type EffectClause, type EffectTiming, type KeywordAbility, type KeywordName } from './types.ts';

export function getEffectSetPrefix(cardNo: string): string {
  const m = cardNo.match(/^([A-Za-z0-9]+)-/);
  const raw = m ? m[1] : 'MISC';
  return raw.replace(/[^A-Za-z0-9_-]/g, '_') || 'MISC';
}

export const KEYWORD_NAMES: Record<string, KeywordName> = {
  repair: 'Repair',
  breach: 'Breach',
  support: 'Support',
  blocker: 'Blocker',
  'first strike': 'First Strike',
  'high-maneuver': 'High-Maneuver',
  suppression: 'Suppression',
};

export const CIRCLED_NUMS: Record<string, number> = {
  '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
};

export const COLORS: CardColor[] = ['Blue', 'Green', 'Red', 'Purple', 'White', 'Colorless'];

export function parseColorWord(raw?: string): CardColor | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  return COLORS.find((c) => c.toLowerCase() === lower);
}

export function extractAllTraits(s: string): string[] {
  return [...s.matchAll(/\(([^)]+)\)/g)]
    .map((m) => m[1].trim())
    .filter((t) => !/^AP\d+/i.test(t) && !/^HP\d+/i.test(t) && !/･/.test(t));
}

export function parseKeywordToken(raw: string): KeywordAbility | null {
  const m = raw.trim().match(/^([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s*(\d+)?$/);
  if (!m) return null;
  const canonical = KEYWORD_NAMES[m[1].toLowerCase()];
  if (!canonical) return null;
  return { name: canonical, value: m[2] ? parseInt(m[2], 10) : null };
}

/** Strips parenthetical rules reminders while preserving (Trait) and token stat tokens. */
export function stripReminderText(effect: string): string {
  const stripOnce = (txt: string) =>
    txt.replace(/\(([^()]*|\([^()]*\)[^()]*)*\)/g, (full) => {
      const inner = full.slice(1, -1).trim();
      if (
        inner.includes('.') ||
        inner.length > 34 ||
        /^(At the |When |While |Rest |Damage |During |If |After |This |You )/i.test(inner)
      ) {
        return '';
      }
      return full;
    });
  return stripOnce(stripOnce(effect));
}

export function parseHeaderTag(
  tag: string,
  timings: Set<EffectTiming>,
  meta: { oncePerTurn: boolean; pairFilter?: EffectClause['pairFilter']; devCost?: number; isPilotTag?: boolean }
) {
  const inner = tag.slice(1, -1).trim();
  if (inner === 'Once per Turn') {
    meta.oncePerTurn = true;
    return;
  }
  const parts = inner.split(/[･・]/).map((p) => p.trim());
  for (const part of parts) {
    switch (part) {
      case 'Deploy': timings.add('DEPLOY'); break;
      case 'Attack': timings.add('ATTACK'); break;
      case 'Destroyed': timings.add('DESTROYED'); break;
      case 'When Paired': timings.add('WHEN_PAIRED'); break;
      case 'When Linked': timings.add('WHEN_LINKED'); break;
      case 'During Pair': timings.add('DURING_PAIR'); break;
      case 'During Link': timings.add('DURING_LINK'); break;
      case 'Burst': timings.add('BURST'); break;
      case 'Main': timings.add('MAIN'); break;
      case 'Action': timings.add('ACTION'); break;
      case 'Activate': break;
      case 'Pilot': meta.isPilotTag = true; break;
      default: {
        const dev = part.match(/^Development\s+(\d+)$/i);
        if (dev) {
          meta.devCost = parseInt(dev[1], 10);
        } else if (part.endsWith('Pilot')) {
          meta.pairFilter ??= {};
          const traitM = part.match(/\(([^)]+)\)/);
          if (traitM) meta.pairFilter.trait = traitM[1];
          const lvLo = part.match(/Lv\.(\d+)\s+or\s+Lower/i);
          if (lvLo) meta.pairFilter.lvMax = parseInt(lvLo[1], 10);
          const lvHi = part.match(/Lv\.(\d+)\s+or\s+Higher/i);
          if (lvHi) meta.pairFilter.lvMin = parseInt(lvHi[1], 10);
          for (const col of COLORS) {
            if (part.includes(col)) meta.pairFilter.color = col;
          }
        }
      }
    }
  }
  if (inner.startsWith('Activate')) {
    if (parts.includes('Main')) {
      timings.delete('MAIN');
      timings.add('ACTIVATE_MAIN');
    }
    if (parts.includes('Action')) {
      timings.delete('ACTION');
      timings.add('ACTIVATE_ACTION');
    }
  }
}

export function parseCost(rawCost: string): ActivationCost {
  const cost: ActivationCost = { raw: rawCost };
  for (const [sym, val] of Object.entries(CIRCLED_NUMS)) {
    if (rawCost.includes(sym)) cost.resourceCost = (cost.resourceCost ?? 0) + val;
  }
  if (/rest this (?:unit|base|card)/i.test(rawCost)) cost.restSelf = true;
  if (/return this (?:unit|card) to the bottom of its owner'?s deck/i.test(rawCost)) {
    cost.returnSelfToDeckBottom = true;
  }
  if (/destroy this unit/i.test(rawCost)) cost.destroySelf = true;
  const disc = rawCost.match(/discard (\d+)/i);
  if (disc) cost.discardCount = parseInt(disc[1], 10);
  const exile = rawCost.match(/exile (\d+)/i);
  if (exile) {
    cost.exileFromTrashCount = parseInt(exile[1], 10);
    if (/pilot card/i.test(rawCost) || /\([^)]+\)/.test(rawCost)) {
      cost.exileFilter = parseTargetSelector(rawCost);
    }
  }
  return cost;
}
