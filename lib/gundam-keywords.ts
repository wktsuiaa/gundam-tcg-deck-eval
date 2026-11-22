import type { CardColor, GundamCardGroup, GundamCardPrint } from '@/types/gundam';

export interface KeywordDefinition {
  tag: string;
  label: string;
  summary: string;
}

export const GUNDAM_KEYWORDS: KeywordDefinition[] = [
  {
    tag: '<Repair',
    label: 'Repair X',
    summary: 'At the end of your turn, this Unit recovers X HP (cannot exceed its max HP).',
  },
  {
    tag: '<Breach',
    label: 'Breach X',
    summary: 'When this Unit’s attack destroys an enemy Unit, deal X damage to the opponent’s Shield area.',
  },
  {
    tag: '<Support',
    label: 'Support X',
    summary: 'Rest this Unit during your Main Phase to give 1 other friendly Unit +X AP until end of turn.',
  },
  {
    tag: '<Blocker',
    label: 'Blocker',
    summary: 'Rest this active Unit when an opponent declares an attack to redirect the attack to this Unit.',
  },
  {
    tag: '<First Strike',
    label: 'First Strike',
    summary: 'While attacking, this Unit deals its battle damage before the defending Unit can counter-damage.',
  },
  {
    tag: '<High-Maneuver',
    label: 'High-Maneuver',
    summary: 'This Unit cannot be blocked by enemy Units with <Blocker>.',
  },
  {
    tag: '<Suppression',
    label: 'Suppression',
    summary: 'Prevents specified opposing Units or effects from blocking or activating during combat.',
  },
  {
    tag: '【When Paired】',
    label: 'When Paired',
    summary: 'Triggers immediately when a Pilot card is placed underneath this Unit (or this Pilot is placed under a Unit).',
  },
  {
    tag: '【When Linked】',
    label: 'When Linked',
    summary: 'Triggers when a Pilot satisfying the Unit’s [Link] condition is paired with this Unit.',
  },
  {
    tag: '【During Pair】',
    label: 'During Pair',
    summary: 'Continuous effect active as long as any Pilot is paired beneath this Unit.',
  },
  {
    tag: '【During Link】',
    label: 'During Link',
    summary: 'Continuous effect active while a matching [Link] Pilot is paired beneath this Unit.',
  },
  {
    tag: '【Deploy】',
    label: 'Deploy',
    summary: 'Triggers once when this Unit or Base enters the Battle Area or Base Area.',
  },
  {
    tag: '【Attack】',
    label: 'Attack',
    summary: 'Triggers when this Unit declares an attack.',
  },
  {
    tag: '【Destroyed】',
    label: 'Destroyed',
    summary: 'Triggers when this Unit is destroyed and sent to the Trash.',
  },
  {
    tag: '【Burst】',
    label: 'Burst',
    summary: 'When revealed from your Shield Area by damage, you may activate this effect immediately without paying Cost.',
  },
  {
    tag: '【Activate･Main】',
    label: 'Activate Main',
    summary: 'Activated ability you can trigger during your Main Phase by paying the listed condition.',
  },
  {
    tag: '【Activate･Action】',
    label: 'Activate Action',
    summary: 'Activated ability usable during your Action Step or combat Action window.',
  },
];

export function extractCardKeywords(effect: string): KeywordDefinition[] {
  if (!effect) return [];
  const lower = effect.toLowerCase();
  return GUNDAM_KEYWORDS.filter((kw) => lower.includes(kw.tag.toLowerCase()));
}

export function getCardImageUrl(imagePath: string): string {
  const clean = imagePath.replace(/^\/+/, '');
  return `/api/card-image?path=${encodeURIComponent(clean)}`;
}

export function groupPrintsByCardNo(cards: GundamCardPrint[]): GundamCardGroup[] {
  const map = new Map<string, GundamCardPrint[]>();
  for (const card of cards) {
    const arr = map.get(card.cardNo) ?? [];
    arr.push(card);
    map.set(card.cardNo, arr);
  }
  const groups: GundamCardGroup[] = [];
  for (const [cardNo, variants] of map.entries()) {
    const sorted = [...variants].sort((a, b) => {
      if (a.isParallel !== b.isParallel) return a.isParallel ? 1 : -1;
      return a.printId.localeCompare(b.printId);
    });
    groups.push({
      cardNo,
      primary: sorted[0],
      variants: sorted,
    });
  }
  return groups;
}

/**
 * Checks whether a Pilot card satisfies a Unit's [Link] condition.
 * Link strings on official cards look like:
 * "[Amuro Ray]", "(White Base Team) Trait", "(Zeon) Trait", "[Kira Yamato] / [Athrun Zala]"
 */
export function doesPilotLinkUnit(pilot: GundamCardPrint, unit: GundamCardPrint): boolean {
  if (pilot.type !== 'PILOT' || unit.type !== 'UNIT' || !unit.link) return false;
  const linkStr = unit.link;

  // Match bracketed character names e.g. [Amuro Ray]
  const nameTokens = [...linkStr.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim().toLowerCase());
  const pilotNameLower = pilot.name.toLowerCase();
  for (const token of nameTokens) {
    if (pilotNameLower === token || pilotNameLower.includes(token) || token.includes(pilotNameLower)) {
      return true;
    }
  }

  // Match parenthesized trait requirements e.g. (Zeon) Trait or (White Base Team)
  const traitTokens = [...linkStr.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim().toLowerCase());
  const pilotTraitsLower = pilot.traits.map((t) => t.toLowerCase());
  for (const tt of traitTokens) {
    if (pilotTraitsLower.some((pt) => pt === tt || pt.includes(tt))) {
      return true;
    }
  }

  return false;
}

export const CARD_COLOR_META: Record<
  CardColor,
  { hex: string; softBg: string; border: string; text: string; short: string }
> = {
  Blue: {
    hex: '#3B82F6',
    softBg: 'bg-blue-500/12',
    border: 'border-blue-500/35',
    text: 'text-blue-400',
    short: 'BLU',
  },
  Green: {
    hex: '#10B981',
    softBg: 'bg-emerald-500/12',
    border: 'border-emerald-500/35',
    text: 'text-emerald-400',
    short: 'GRN',
  },
  Red: {
    hex: '#EF4444',
    softBg: 'bg-red-500/12',
    border: 'border-red-500/35',
    text: 'text-red-400',
    short: 'RED',
  },
  Purple: {
    hex: '#A855F7',
    softBg: 'bg-purple-500/12',
    border: 'border-purple-500/35',
    text: 'text-purple-400',
    short: 'PRP',
  },
  White: {
    hex: '#E2E8F0',
    softBg: 'bg-slate-200/12',
    border: 'border-slate-300/35',
    text: 'text-slate-200',
    short: 'WHT',
  },
  Colorless: {
    hex: '#94A3B8',
    softBg: 'bg-slate-500/12',
    border: 'border-slate-500/35',
    text: 'text-slate-400',
    short: 'CLR',
  },
};
