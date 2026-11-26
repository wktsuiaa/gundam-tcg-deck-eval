import type { DeckGenerationConstraints, EffectStyleTag, HexagonAxes, StrategyBlueprint, TacticalStyleTag } from '@/types/gundam';

export interface StrategyStyleMeta {
  tag: TacticalStyleTag;
  description: string;
  targetBias: Partial<HexagonAxes>;
}

export const TACTICAL_STYLE_META: StrategyStyleMeta[] = [
  {
    tag: 'Rush / Aggro',
    description: 'Low-cost attackers, <Breach> and <First Strike> burn Shields before opponents stabilize.',
    targetBias: { aggro: 90, attack: 72, synergy: 50 },
  },
  {
    tag: 'Midrange / Value',
    description: 'Blends curve efficiency, solid Unit bodies, Link threats, and flexible removal.',
    targetBias: { aggro: 65, defense: 65, attack: 58, liquidity: 62, synergy: 68, control: 60 },
  },
  {
    tag: 'Control / Attrition',
    description: 'Rest, bounce, AP deduction and <Blocker> / <Repair> walls grind opponents out of threats.',
    targetBias: { control: 90, defense: 78, liquidity: 65 },
  },
  {
    tag: 'Ramp / Big Unit',
    description: 'Accelerates Resources and EX Resources to deploy Lv.5–7 boss Units ahead of curve.',
    targetBias: { liquidity: 72, defense: 62, aggro: 66 },
  },
  {
    tag: 'Link / Synergy Combo',
    description: 'Maximizes Pilot–Unit Link pairs for immediate 【When Linked】 triggers and combined AP/HP spikes.',
    targetBias: { synergy: 90, aggro: 66, attack: 60 },
  },
  {
    tag: 'Burn / Ping',
    description: 'Direct damage, attack triggers and evasive keywords chip Shields and Units outside normal combat.',
    targetBias: { attack: 90, control: 62, aggro: 60 },
  },
];

export interface EffectStyleMeta {
  tag: EffectStyleTag;
  label: string;
  description: string;
  primaryAxis: keyof HexagonAxes;
}

export const EFFECT_STYLE_META: EffectStyleMeta[] = [
  {
    tag: 'Attack / Ping',
    label: 'Attack / Ping',
    description: 'Deals direct damage, boosts AP, or packs <Breach>, <First Strike>, <High-Maneuver>, <Suppression>.',
    primaryAxis: 'attack',
  },
  {
    tag: 'Board / Deploy',
    label: 'Board / Deploy',
    description: 'Deploys tokens or extra bodies, and holds the board with <Blocker>, <Repair> and damage proofing.',
    primaryAxis: 'defense',
  },
  {
    tag: 'Removal / Disrupt',
    label: 'Removal / Disrupt',
    description: 'Destroys, bounces, rests or shrinks (AP-X) enemy Units to clear threats.',
    primaryAxis: 'control',
  },
  {
    tag: 'Draw / Recursion',
    label: 'Draw / Recursion',
    description: 'Draws or searches cards and recovers Units, Pilots or Commands from the Trash.',
    primaryAxis: 'liquidity',
  },
  {
    tag: 'Resource / Ramp',
    label: 'Resource / Ramp',
    description: 'Adds active/EX Resources or reduces play costs to accelerate Lv.5+ threats.',
    primaryAxis: 'liquidity',
  },
  {
    tag: 'Link / Synergy',
    label: 'Link / Synergy',
    description: 'Rewards Pilot–Unit pairing with 【When Paired】 / 【When Linked】 triggers, <Support> and re-pairing.',
    primaryAxis: 'synergy',
  },
];

export const DEFAULT_CONSTRAINTS: DeckGenerationConstraints = {
  allowedPackageCodes: [],
  maxCopiesPerCard: 4,
  maxCost: null,
  maxLv: null,
  rarityCap: 'ALL',
  strictTraitLinkLock: false,
};

export function normalizeTraitFocus(raw?: string | string[] | null): string[] {
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
      const trimmed = typeof item === 'string' ? item.trim() : '';
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
        out.push(trimmed);
      }
    }
    return out;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

export const DEFAULT_BLUEPRINT: StrategyBlueprint = {
  colors: ['Blue', 'White'],
  pacing: 'Midrange Tempo',
  styles: ['Link / Synergy Combo'],
  effectStyles: [],
  traitFocus: [],
  targetHexagon: {
    aggro: 65,
    defense: 60,
    attack: 60,
    liquidity: 65,
    synergy: 85,
    control: 55,
  },
  constraints: DEFAULT_CONSTRAINTS,
};

export const LEGACY_STRATEGY_MAP: Record<string, TacticalStyleTag> = {
  'Link-Strike': 'Link / Synergy Combo',
  'High-Liquidity Draw': 'Midrange / Value',
  'Repair Fortress': 'Control / Attrition',
  'Shield Breach': 'Rush / Aggro',
  'Wide Swarm': 'Rush / Aggro',
  'Command Control': 'Control / Attrition',
  'Resource Ramp': 'Ramp / Big Unit',
  'Balanced Midrange': 'Midrange / Value',
};

export const LEGACY_EFFECT_STYLE_MAP: Record<string, EffectStyleTag> = {
  'AP Deduction': 'Removal / Disrupt',
  Destroy: 'Removal / Disrupt',
  'Damage Proof': 'Board / Deploy',
  Repair: 'Board / Deploy',
  Bounce: 'Removal / Disrupt',
  'Rest Lock': 'Removal / Disrupt',
  'Direct Damage': 'Attack / Ping',
  'Draw & Search': 'Draw / Recursion',
  'Trash Recursion': 'Draw / Recursion',
  'Resource Ramp': 'Resource / Ramp',
  'Combat Keywords': 'Attack / Ping',
  'Token Deploy': 'Board / Deploy',
};

/** Reads a persisted blueprint, upgrading legacy strategy / effect-style names and the old `tempo` axis. */
export function normalizeBlueprint(raw?: StrategyBlueprint): StrategyBlueprint {
  if (!raw) return DEFAULT_BLUEPRINT;
  const isStrategy = (t: string): t is TacticalStyleTag => TACTICAL_STYLE_META.some((m) => m.tag === t);
  const isEffectStyle = (t: string): t is EffectStyleTag => EFFECT_STYLE_META.some((m) => m.tag === t);
  const legacyPrimary = (raw as unknown as { primaryStyle?: string }).primaryStyle;

  const strategies = [...(Array.isArray(raw.styles) ? raw.styles : []), legacyPrimary ?? '']
    .map((t) => (isStrategy(t) ? t : LEGACY_STRATEGY_MAP[t]))
    .filter((t): t is TacticalStyleTag => Boolean(t));
  const effectStyles = [
    ...new Set(
      (Array.isArray(raw.effectStyles) ? raw.effectStyles : [])
        .map((t) => (isEffectStyle(t) ? t : LEGACY_EFFECT_STYLE_MAP[t]))
        .filter((t): t is EffectStyleTag => Boolean(t))
    ),
  ].slice(0, 2);

  // Legacy `tempo` measured curve and ramp, not ping damage, so it is dropped rather than carried into `attack`.
  const { tempo: _legacyTempo, ...savedAxes } = (raw.targetHexagon ?? {}) as Partial<HexagonAxes> & { tempo?: number };
  const targetHexagon: HexagonAxes = { ...DEFAULT_BLUEPRINT.targetHexagon, ...savedAxes };

  return {
    colors: Array.isArray(raw.colors) ? raw.colors : DEFAULT_BLUEPRINT.colors,
    pacing: raw.pacing ?? DEFAULT_BLUEPRINT.pacing,
    styles: [strategies[0] ?? DEFAULT_BLUEPRINT.styles[0]],
    effectStyles,
    traitFocus: normalizeTraitFocus((raw as unknown as { traitFocus?: string | string[] }).traitFocus),
    targetHexagon,
    constraints: { ...DEFAULT_CONSTRAINTS, ...(raw.constraints ?? {}) },
  };
}
