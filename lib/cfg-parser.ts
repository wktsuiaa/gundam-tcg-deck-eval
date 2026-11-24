import { CstParser, Lexer, createToken, type CstNode, type IToken } from 'chevrotain';
import type { GundamCardPrint } from '../types/gundam.ts';
import type {
  ActivationCost,
  EffectClause,
  EffectCondition,
  EffectDuration,
  EffectPrerequisite,
  EffectStep,
  EffectTiming,
  KeywordAbility,
  KeywordName,
  LinkRequirement,
  ScaleMetric,
  TargetSelector,
  TriggerEvent,
} from './effect-parser.ts';

// ---------------------------------------------------------------------------
// 1. Typed Top-Level Ability AST Schema (ADR-0003)
// ---------------------------------------------------------------------------

export type ReplacementEventKind =
  | 'WOULD_BE_DESTROYED'
  | 'WOULD_TAKE_DAMAGE'
  | 'WOULD_REST'
  | 'WOULD_MOVE_ZONE';

export type ProhibitionRule =
  | 'CANT_ATTACK'
  | 'CANT_BLOCK'
  | 'CANT_ACTIVATE_BLOCKER'
  | 'CANT_RECEIVE_BATTLE_DAMAGE'
  | 'CANT_RECEIVE_EFFECT_DAMAGE'
  | 'CANT_RECEIVE_DAMAGE'
  | 'CANT_CHOOSE_ENEMY_PLAYER'
  | 'CANT_BE_CHOSEN'
  | 'CANT_SET_ACTIVE'
  | 'CANT_BE_RESTED'
  | 'CANT_BE_PAIRED'
  | 'CANT_DEPLOY'
  | 'CANT_BE_DESTROYED';

export interface EffectClauseAst {
  kind: 'EFFECT_CLAUSE';
  clauseIndex: number;
  raw: string;
  timings: EffectTiming[];
  oncePerTurn: boolean;
  triggerEvent?: TriggerEvent;
  linkRequirement?: LinkRequirement;
  cost?: ActivationCost;
  condition?: EffectCondition;
  steps: EffectStep[];
  modalGroup?: string;
  insteadUpgrade?: {
    condition?: EffectCondition;
    rawUpgrade: string;
  };
}

export interface ReplacementEffectAst {
  kind: 'REPLACEMENT_EFFECT';
  clauseIndex: number;
  raw: string;
  scope: 'ACTIVE_ZONE' | 'PAIRED' | 'LINKED';
  intercepts: ReplacementEventKind;
  subject: TargetSelector;
  condition?: EffectCondition;
  optional: boolean;
  duration?: EffectDuration;
  replacementSummary: string;
  maxPerEventInstance: 1;
}

export interface ContinuousModifierAst {
  kind: 'CONTINUOUS_MODIFIER';
  clauseIndex: number;
  raw: string;
  layer: 2 | 3 | 4;
  activeIn: 'BATTLE_AREA' | 'HAND' | 'TRASH' | 'ANY';
  requiresPair?: boolean;
  requiresLink?: LinkRequirement;
  oncePerTurn?: boolean;
  condition?: EffectCondition;
  duration?: EffectDuration;
  modifier:
    | {
        type: 'MODIFY_STAT';
        stat: 'AP' | 'HP';
        delta: number;
        scaleBy?: ScaleMetric;
        target: TargetSelector;
      }
    | {
        type: 'COST_REDUCTION';
        amount: number;
        lvDelta?: number;
        target: TargetSelector;
      }
    | {
        type: 'GRANT_KEYWORD';
        keyword: KeywordAbility;
        target: TargetSelector;
      }
    | {
        type: 'GRANT_TRAIT';
        traits: string[];
        target: TargetSelector;
      }
    | {
        type: 'NAME_ALIAS';
        alias: string;
      }
    | {
        type: 'GRANT_PILOT_MODE';
        pilotName: string;
      }
    | {
        type: 'PROHIBITION';
        rule: ProhibitionRule;
        target: TargetSelector;
        sourceFilter?: TargetSelector;
      }
    | {
        type: 'STATIC_PERMISSION';
        summary: string;
        target: TargetSelector;
      };
}

export interface CustomHookAst {
  kind: 'CUSTOM_HOOK';
  clauseIndex: number;
  hookId: string;
  version: number;
  raw: string;
  prerequisites: EffectPrerequisite[];
}

export type AbilityAst =
  | EffectClauseAst
  | ReplacementEffectAst
  | ContinuousModifierAst
  | CustomHookAst;

export interface CustomHookDefinition {
  hookId: string;
  version: number;
  description: string;
  prerequisites?: EffectPrerequisite[];
}

/**
 * Deterministic versioned registry for rare 1-of card clauses outside core CFG rules.
 * CI fails if any card references an unregistered CustomHook.
 */
export const CUSTOM_HOOK_REGISTRY: Record<string, CustomHookDefinition> = {
  'ST01-015#2': {
    hookId: 'ST01-015#2',
    version: 1,
    description:
      'White Base: Activate-Main pay 2 to deploy 1 Gundam (0 Units), Guncannon (1 Unit), or Guntank (2+ Units) token.',
  },
};

export interface CfgParseResult {
  cardNo: string;
  keywords: KeywordAbility[];
  abilities: AbilityAst[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// 2. Deterministic Pre-Parse Structural Normalizer
// ---------------------------------------------------------------------------

const CIRCLED_TO_INT: Record<string, number> = {
  '①': 1,
  '②': 2,
  '③': 3,
  '④': 4,
  '⑤': 5,
  '⑥': 6,
  '⑦': 7,
  '⑧': 8,
  '⑨': 9,
  '⑩': 10,
};

const KEYWORD_NAMES: Record<string, KeywordName> = {
  repair: 'Repair',
  breach: 'Breach',
  support: 'Support',
  blocker: 'Blocker',
  'first strike': 'First Strike',
  'high-maneuver': 'High-Maneuver',
  suppression: 'Suppression',
};

function stripReminderParentheticals(text: string): string {
  // Remove sentence-like rules reminders while preserving (Trait) and ((Trait)･AP3･HP3) tokens.
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')') depth -= 1;
        j += 1;
      }
      const inner = text.slice(i + 1, j - 1);
      const isReminder =
        depth === 0 &&
        (/\s/.test(inner.trim()) &&
          (/^(When|This|Damage|All|Choose|Discard|If|Once|During|At|You|It|Only|A |An |The |While|Each|Units|Battle|Pairs|Tokens|Add|Place|Return|Rest|Destroy|Exile|Look|Reveal|Reduce|Increase|Deploy|Play|Pay|Before|After)/i.test(
            inner.trim()
          ) ||
            /\.$/.test(inner.trim())));
      if (isReminder) {
        i = j;
        continue;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function normalizeGlyphs(line: string): string {
  let out = line.replace(/：/g, '<COST_SEP>').replace(/･/g, '<DOT>').replace(/・/g, '<DOT>');
  for (const [glyph, num] of Object.entries(CIRCLED_TO_INT)) {
    out = out.replaceAll(glyph, `<RES_COST:${num}>`);
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

export function normalizeCardEffectText(rawEffect: string): string {
  if (!rawEffect || !rawEffect.trim() || rawEffect.trim() === '-') return '';
  const stripped = stripReminderParentheticals(rawEffect);
  const rawLines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const normalizedLines: string[] = [];
  let activeModalPrefix = '';
  let pendingFollowUpPrefix = '';

  for (const rawLine of rawLines) {
    // Modal boilerplate line e.g. "【Action】When playing this card, choose 1 of the following effects and activate it："
    // or "【Deploy・Development 1】You may exile ... If you do, activate the following effect:"
    const modalIntroMatch = rawLine.match(
      /^((?:【[^】]+】(?:\s*\/\s*【[^】]+】)*)+)\s*(?:When playing this card,\s*choose 1 of the following effects and activate it[:：]|.*activate the following effect[:：])\s*$/i
    );
    if (modalIntroMatch) {
      const headers = modalIntroMatch[1];
      if (/Development\s+\d+/i.test(headers)) {
        const bodyPrefix = rawLine
          .slice(headers.length)
          .replace(/activate the following effect[:：]\s*$/i, '')
          .trim();
        activeModalPrefix = `${headers} ${bodyPrefix}`.trim();
        pendingFollowUpPrefix = activeModalPrefix;
      } else {
        activeModalPrefix = headers;
        pendingFollowUpPrefix = '';
      }
      continue;
    }

    if (/^■/.test(rawLine)) {
      const optionBody = rawLine.replace(/^■\s*/, '').trim();
      const combined = activeModalPrefix ? `${activeModalPrefix} ${optionBody}`.trim() : optionBody;
      pendingFollowUpPrefix = '';
      normalizedLines.push(normalizeGlyphs(combined));
      continue;
    }

    if (pendingFollowUpPrefix && !/^【/.test(rawLine)) {
      const combined = `${pendingFollowUpPrefix} ${rawLine}`.trim();
      pendingFollowUpPrefix = '';
      activeModalPrefix = '';
      normalizedLines.push(normalizeGlyphs(combined));
      continue;
    }

    activeModalPrefix = '';
    pendingFollowUpPrefix = '';
    normalizedLines.push(normalizeGlyphs(rawLine));
  }

  return normalizedLines.join('\n');
}

// ---------------------------------------------------------------------------
// 3. Chevrotain Pure-TypeScript CFG Lexer & Parser
// ---------------------------------------------------------------------------

const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t\r\n]+/,
  group: Lexer.SKIPPED,
});
const TimingTag = createToken({ name: 'TimingTag', pattern: /【[^】]+】/ });
const ResCostTag = createToken({ name: 'ResCostTag', pattern: /<RES_COST:\d+>/ });
const CostSep = createToken({ name: 'CostSep', pattern: /<COST_SEP>/ });
const DotSep = createToken({ name: 'DotSep', pattern: /<DOT>/ });
const KeywordTag = createToken({ name: 'KeywordTag', pattern: /<[^<>]+>/ });
const BracketName = createToken({ name: 'BracketName', pattern: /\[[^\[\]]+\]/ });
const ParenToken = createToken({
  name: 'ParenToken',
  pattern: /\((?:[^()]+|\([^()]*\))*\)/,
});
const QuotedStr = createToken({ name: 'QuotedStr', pattern: /"[^"]*"/ });

const KwWould = createToken({ name: 'KwWould', pattern: /\bwould\b/i });
const KwInstead = createToken({ name: 'KwInstead', pattern: /\binstead\b/i });
const KwCant = createToken({ name: 'KwCant', pattern: /\b(?:can't|cannot)\b/i });
const KwDoesnt = createToken({ name: 'KwDoesnt', pattern: /\bdoesn't\b/i });
const KwWhen = createToken({ name: 'KwWhen', pattern: /\b(?:When|Whenever)\b/i });
const KwIf = createToken({ name: 'KwIf', pattern: /\bIf\b/ });
const KwDuring = createToken({ name: 'KwDuring', pattern: /\bDuring\b/ });
const KwWhile = createToken({ name: 'KwWhile', pattern: /\bWhile\b/ });
const KwAt = createToken({ name: 'KwAt', pattern: /\bAt\b/ });

const Slash = createToken({ name: 'Slash', pattern: /\// });
const Comma = createToken({ name: 'Comma', pattern: /,/ });
const Period = createToken({ name: 'Period', pattern: /\./ });
const Colon = createToken({ name: 'Colon', pattern: /:/ });
const NumberTok = createToken({ name: 'NumberTok', pattern: /[+-]?\d+/ });
const WordTok = createToken({ name: 'WordTok', pattern: /[^\s,./:【】<>[\]()"]+/ });

const ALL_TOKENS = [
  WhiteSpace,
  TimingTag,
  ResCostTag,
  CostSep,
  DotSep,
  KeywordTag,
  BracketName,
  ParenToken,
  QuotedStr,
  KwWould,
  KwInstead,
  KwCant,
  KwDoesnt,
  KwWhen,
  KwIf,
  KwDuring,
  KwWhile,
  KwAt,
  Slash,
  Comma,
  Period,
  Colon,
  NumberTok,
  WordTok,
];

const GundamLexer = new Lexer(ALL_TOKENS);

class GundamClauseCstParser extends CstParser {
  constructor() {
    super(ALL_TOKENS, { recoveryEnabled: false });
    this.performSelfAnalysis();
  }

  public clauseLine = this.RULE('clauseLine', () => {
    this.OR([
      {
        GATE: () => this.isKeywordOnlyLine(),
        ALT: () => this.SUBRULE(this.keywordOnlyUnit),
      },
      {
        GATE: () => this.isReplacementClause(),
        ALT: () => this.SUBRULE(this.replacementUnit),
      },
      {
        GATE: () => this.isContinuousClause(),
        ALT: () => this.SUBRULE(this.continuousUnit),
      },
      {
        ALT: () => this.SUBRULE(this.effectClauseUnit),
      },
    ]);
  });

  private keywordOnlyUnit = this.RULE('keywordOnlyUnit', () => {
    this.AT_LEAST_ONE(() => {
      this.CONSUME(KeywordTag);
    });
  });

  private replacementUnit = this.RULE('replacementUnit', () => {
    this.MANY(() => {
      this.SUBRULE(this.timingPrefix);
    });
    this.MANY2(() => {
      this.OR([
        { ALT: () => this.CONSUME(KwWould) },
        { ALT: () => this.CONSUME(KwInstead) },
        { ALT: () => this.CONSUME(KwDoesnt) },
        { ALT: () => this.CONSUME(KwWhen) },
        { ALT: () => this.CONSUME(KwIf) },
        { ALT: () => this.CONSUME(KwDuring) },
        { ALT: () => this.CONSUME(KwWhile) },
        { ALT: () => this.CONSUME(KwAt) },
        { ALT: () => this.SUBRULE(this.clauseBodyAtom) },
      ]);
    });
  });

  private continuousUnit = this.RULE('continuousUnit', () => {
    this.MANY(() => {
      this.SUBRULE(this.timingPrefix);
    });
    this.AT_LEAST_ONE(() => {
      this.OR([
        { ALT: () => this.CONSUME(KwCant) },
        { ALT: () => this.CONSUME(KwIf) },
        { ALT: () => this.CONSUME(KwDuring) },
        { ALT: () => this.CONSUME(KwWhile) },
        { ALT: () => this.CONSUME(KwAt) },
        { ALT: () => this.CONSUME(KwWhen) },
        { ALT: () => this.SUBRULE(this.clauseBodyAtom) },
      ]);
    });
  });

  private effectClauseUnit = this.RULE('effectClauseUnit', () => {
    this.MANY(() => {
      this.SUBRULE(this.timingPrefix);
    });
    this.AT_LEAST_ONE(() => {
      this.OR([
        { ALT: () => this.CONSUME(KwWhen) },
        { ALT: () => this.CONSUME(KwIf) },
        { ALT: () => this.CONSUME(KwDuring) },
        { ALT: () => this.CONSUME(KwWhile) },
        { ALT: () => this.CONSUME(KwAt) },
        { ALT: () => this.CONSUME(KwCant) },
        { ALT: () => this.CONSUME(KwInstead) },
        { ALT: () => this.CONSUME(KwDoesnt) },
        { ALT: () => this.CONSUME(KwWould) },
        { ALT: () => this.SUBRULE(this.clauseBodyAtom) },
      ]);
    });
  });

  private timingPrefix = this.RULE('timingPrefix', () => {
    this.CONSUME(TimingTag);
    this.OPTION(() => {
      this.CONSUME(Slash);
      this.CONSUME2(TimingTag);
    });
  });

  private clauseBodyAtom = this.RULE('clauseBodyAtom', () => {
    this.OR([
      { ALT: () => this.CONSUME(ResCostTag) },
      { ALT: () => this.CONSUME(CostSep) },
      { ALT: () => this.CONSUME(DotSep) },
      { ALT: () => this.CONSUME(TimingTag) },
      { ALT: () => this.CONSUME(KeywordTag) },
      { ALT: () => this.CONSUME(BracketName) },
      { ALT: () => this.CONSUME(ParenToken) },
      { ALT: () => this.CONSUME(QuotedStr) },
      { ALT: () => this.CONSUME(Slash) },
      { ALT: () => this.CONSUME(Comma) },
      { ALT: () => this.CONSUME(Period) },
      { ALT: () => this.CONSUME(Colon) },
      { ALT: () => this.CONSUME(NumberTok) },
      { ALT: () => this.CONSUME(WordTok) },
    ]);
  });

  // Lookahead predicates keeping LL(k) selection deterministic & ambiguity-free
  private scanLineTokens(): IToken[] {
    const out: IToken[] = [];
    for (let i = 1; i <= 200; i += 1) {
      const tok = this.LA(i);
      if (!tok || tok.tokenType.name === 'EOF') break;
      out.push(tok);
    }
    return out;
  }

  private isKeywordOnlyLine(): boolean {
    const toks = this.scanLineTokens();
    return toks.length > 0 && toks.every((t) => t.tokenType === KeywordTag);
  }

  private isReplacementClause(): boolean {
    const toks = this.scanLineTokens();
    const hasWould = toks.some((t) => t.tokenType === KwWould);
    const hasInstead = toks.some((t) => t.tokenType === KwInstead);
    const hasDoesnt = toks.some((t) => t.tokenType === KwDoesnt);
    const timingTags = toks
      .filter((t) => t.tokenType === TimingTag)
      .map((t) => t.image);
    const hasActiveSpellOrAction = timingTags.some((img) =>
      /【(?:Main|Action|Burst|Deploy|Activate)/i.test(img)
    );
    // True event replacements: "would ... instead", "would ... doesn't receive", or "When you rest ... instead"
    if (hasWould && (hasInstead || hasDoesnt)) return true;
    const text = toks.map((t) => t.image).join(' ');
    if (
      !hasActiveSpellOrAction &&
      hasInstead &&
      /\bWhen\s+you\s+rest\b/i.test(text)
    ) {
      return true;
    }
    return false;
  }

  private isContinuousClause(): boolean {
    const toks = this.scanLineTokens();
    const timingTags = toks
      .filter((t) => t.tokenType === TimingTag)
      .map((t) => t.image);
    const nonOnceTimings = timingTags.filter((img) => img !== '【Once per Turn】');
    const hasStaticTiming = nonOnceTimings.some((img) =>
      /【(?:During Pair|During Link|Pilot)/i.test(img)
    );
    const hasActiveTiming = nonOnceTimings.some(
      (img) => !/【(?:During Pair|During Link|Pilot)/i.test(img)
    );
    if (hasActiveTiming) return false;

    const text = toks.map((t) => t.image).join(' ');
    if (/name is also treated as/i.test(text)) return true;

    // Phase-boundary triggers ("At the end of your turn,", "At the start of your opponent's turn,")
    if (/^【Once per Turn】\s*At\s+the\s+(?:end|start)\s+of\b|^At\s+the\s+(?:end|start)\s+of\b/i.test(text)) {
      return false;
    }

    // Reactive "when/whenever" triggers (even under 【During Pair】 or "During your turn,")
    const hasReactiveWhen = toks.some((t) => t.tokenType === KwWhen);
    if (hasReactiveWhen && !/\bwhile\b/i.test(text.split(/\bwhen\b/i)[0] ?? '')) {
      return false;
    }

    if (hasStaticTiming) return true;

    if (
      /can't|cannot/i.test(text) ||
      (/\b(?:Increase|Reduce|gains|gets)\b/i.test(text) && !/during this turn/i.test(text))
    ) {
      return true;
    }
    return nonOnceTimings.length === 0;
  }
}

const clauseParser = new GundamClauseCstParser();

// ---------------------------------------------------------------------------
// 4. CST-to-AST Helpers & Lifting
// ---------------------------------------------------------------------------

function parseKeywordTag(raw: string): KeywordAbility | null {
  const inner = raw.replace(/^<|>$/g, '').trim();
  const m = inner.match(/^([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s*(\d+)?$/);
  if (!m) return null;
  const canonical = KEYWORD_NAMES[m[1].toLowerCase()];
  if (!canonical) return null;
  return { name: canonical, value: m[2] ? parseInt(m[2], 10) : null };
}

function detectProhibitionRule(text: string): ProhibitionRule {
  if (/can't receive battle damage/i.test(text)) return 'CANT_RECEIVE_BATTLE_DAMAGE';
  if (/can't receive effect damage/i.test(text)) return 'CANT_RECEIVE_EFFECT_DAMAGE';
  if (/can't receive damage/i.test(text)) return 'CANT_RECEIVE_DAMAGE';
  if (/can't choose the enemy player/i.test(text)) return 'CANT_CHOOSE_ENEMY_PLAYER';
  if (/can't be chosen/i.test(text)) return 'CANT_BE_CHOSEN';
  if (/can't activate <Blocker>/i.test(text)) return 'CANT_ACTIVATE_BLOCKER';
  if (/can't be blocked/i.test(text)) return 'CANT_BLOCK';
  if (/can't attack/i.test(text)) return 'CANT_ATTACK';
  if (/can't be set as active|can't set .* active/i.test(text)) return 'CANT_SET_ACTIVE';
  if (/can't be rested/i.test(text)) return 'CANT_BE_RESTED';
  if (/can't be paired/i.test(text)) return 'CANT_BE_PAIRED';
  if (/can't be destroyed/i.test(text)) return 'CANT_BE_DESTROYED';
  return 'CANT_DEPLOY';
}

function detectReplacementIntercept(text: string): ReplacementEventKind {
  if (/would receive .*damage/i.test(text)) return 'WOULD_TAKE_DAMAGE';
  if (/would rest|When you rest .* instead/i.test(text)) return 'WOULD_REST';
  if (/would be destroyed/i.test(text)) return 'WOULD_BE_DESTROYED';
  return 'WOULD_MOVE_ZONE';
}

function liftContinuousModifier(
  clauseIndex: number,
  raw: string,
  legacyClause: EffectClause | undefined
): ContinuousModifierAst {
  const requiresPair =
    /【During Pair/i.test(raw) || (legacyClause?.timings.includes('DURING_PAIR') ?? false);
  const requiresLink = legacyClause?.linkRequirement;
  const oncePerTurn = /【Once per Turn】/.test(raw) || (legacyClause?.oncePerTurn ?? false);
  const condition = legacyClause?.condition;
  const duration: EffectDuration | undefined = /during this battle/i.test(raw)
    ? 'THIS_BATTLE'
    : /during this turn/i.test(raw)
    ? 'THIS_TURN'
    : 'CONTINUOUS';

  // Layer 4: "can't" / "cannot" prohibitions
  if (/\b(?:can't|cannot)\b/i.test(raw)) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 4,
      activeIn: 'BATTLE_AREA',
      ...(requiresPair ? { requiresPair } : {}),
      ...(requiresLink ? { requiresLink } : {}),
      ...(oncePerTurn ? { oncePerTurn } : {}),
      ...(condition ? { condition } : {}),
      duration,
      modifier: {
        type: 'PROHIBITION',
        rule: detectProhibitionRule(raw),
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      },
    };
  }

  // Layer 2: Name alias & Command Pilot mode
  const aliasMatch = raw.match(/name is also treated as \[([^\]]+)\]/i);
  if (aliasMatch) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 2,
      activeIn: 'ANY',
      modifier: { type: 'NAME_ALIAS', alias: aliasMatch[1].trim() },
    };
  }

  const pilotModeMatch = raw.match(/^【Pilot】\[([^\]]+)\]/i);
  if (pilotModeMatch) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 2,
      activeIn: 'HAND',
      modifier: { type: 'GRANT_PILOT_MODE', pilotName: pilotModeMatch[1].trim() },
    };
  }

  // Layer 2: Keyword or Trait grants
  const kwMatch = raw.match(/gains\s*(<[^<>]+>)/i);
  const kwParsed = kwMatch ? parseKeywordTag(kwMatch[1]) : null;
  if (kwParsed) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 2,
      activeIn: 'BATTLE_AREA',
      ...(requiresPair ? { requiresPair } : {}),
      ...(requiresLink ? { requiresLink } : {}),
      ...(condition ? { condition } : {}),
      duration,
      modifier: {
        type: 'GRANT_KEYWORD',
        keyword: kwParsed,
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      },
    };
  }

  // Layer 3: Stat adjustments & cost reduction (from legacyClause or direct clause patterns)
  const legacyModAp = legacyClause?.steps.find((s) => s.action === 'MODIFY_AP');
  if (legacyModAp && legacyModAp.action === 'MODIFY_AP') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: 'BATTLE_AREA',
      ...(requiresPair ? { requiresPair } : {}),
      ...(requiresLink ? { requiresLink } : {}),
      ...(condition ? { condition } : {}),
      duration,
      modifier: {
        type: 'MODIFY_STAT',
        stat: 'AP',
        delta: legacyModAp.delta,
        ...(legacyModAp.scaleBy ? { scaleBy: legacyModAp.scaleBy } : {}),
        target: legacyModAp.target,
      },
    };
  }

  const statDirect = raw.match(/(Increase|Reduce)\s+.*?(AP|HP)\s+by\s+(\d+|an amount equal to.+)/i) ??
    raw.match(/\bgets\s+(AP|HP)([+-]\d+)/i);
  if (statDirect) {
    const isAp = /AP/i.test(statDirect[2] ?? statDirect[1]);
    const stat: 'AP' | 'HP' = isAp ? 'AP' : 'HP';
    const numMatch = (statDirect[3] ?? statDirect[2] ?? '').match(/[+-]?\d+/);
    const sign = /^Reduce/i.test(statDirect[1]) ? -1 : 1;
    const delta = numMatch ? sign * Math.abs(parseInt(numMatch[0], 10)) : sign;
    const scaleBy: ScaleMetric | undefined = /number of cards in your hand/i.test(raw)
      ? { metric: 'HAND_COUNT', owner: 'SELF' }
      : /number of .*cards in your trash/i.test(raw)
      ? { metric: 'TRASH_COUNT', owner: 'SELF' }
      : undefined;
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: 'BATTLE_AREA',
      ...(requiresPair ? { requiresPair } : {}),
      ...(requiresLink ? { requiresLink } : {}),
      ...(condition ? { condition } : {}),
      duration,
      modifier: {
        type: 'MODIFY_STAT',
        stat,
        delta,
        ...(scaleBy ? { scaleBy } : {}),
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      },
    };
  }

  const legacyCostRed = legacyClause?.steps.find((s) => s.action === 'COST_REDUCTION');
  if (legacyCostRed && legacyCostRed.action === 'COST_REDUCTION') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: legacyCostRed.zone === 'TRASH' ? 'TRASH' : 'HAND',
      ...(condition ? { condition } : {}),
      modifier: {
        type: 'COST_REDUCTION',
        amount: legacyCostRed.amount,
        ...(legacyCostRed.lvDelta ? { lvDelta: legacyCostRed.lvDelta } : {}),
        target: { owner: 'SELF', self: true },
      },
    };
  }

  const costDirect = raw.match(/Reduce the cost of .*? by (\d+)/i);
  if (costDirect) {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: 'HAND',
      ...(condition ? { condition } : {}),
      modifier: {
        type: 'COST_REDUCTION',
        amount: parseInt(costDirect[1], 10),
        target: { owner: 'SELF', self: true },
      },
    };
  }

  // Remaining static Layer-2/3 rules (e.g., ALLOW_ATTACK_ACTIVE, GRANT_TRAIT, MODIFY_HP)
  const legacyHp = legacyClause?.steps.find((s) => s.action === 'MODIFY_HP');
  if (legacyHp && legacyHp.action === 'MODIFY_HP') {
    return {
      kind: 'CONTINUOUS_MODIFIER',
      clauseIndex,
      raw,
      layer: 3,
      activeIn: 'BATTLE_AREA',
      ...(requiresPair ? { requiresPair } : {}),
      ...(requiresLink ? { requiresLink } : {}),
      ...(condition ? { condition } : {}),
      duration,
      modifier: {
        type: 'MODIFY_STAT',
        stat: 'HP',
        delta: legacyHp.delta,
        ...(legacyHp.scaleBy ? { scaleBy: legacyHp.scaleBy } : {}),
        target: legacyHp.target,
      },
    };
  }

  return {
    kind: 'CONTINUOUS_MODIFIER',
    clauseIndex,
    raw,
    layer: 2,
    activeIn: 'BATTLE_AREA',
    ...(requiresPair ? { requiresPair } : {}),
    ...(requiresLink ? { requiresLink } : {}),
    ...(condition ? { condition } : {}),
    duration,
    modifier: {
      type: 'STATIC_PERMISSION',
      summary: raw,
      target: { owner: 'SELF', self: true, cardType: 'UNIT' },
    },
  };
}

function liftReplacementEffect(
  clauseIndex: number,
  raw: string,
  legacyClause: EffectClause | undefined
): ReplacementEffectAst {
  const scope: ReplacementEffectAst['scope'] = /【During Link】/i.test(raw)
    ? 'LINKED'
    : /【During Pair/i.test(raw)
    ? 'PAIRED'
    : 'ACTIVE_ZONE';

  return {
    kind: 'REPLACEMENT_EFFECT',
    clauseIndex,
    raw,
    scope,
    intercepts: detectReplacementIntercept(raw),
    subject: { owner: 'SELF', self: true, cardType: 'UNIT' },
    ...(legacyClause?.condition ? { condition: legacyClause.condition } : {}),
    optional: /\byou may\b/i.test(raw),
    duration: /during this battle/i.test(raw)
      ? 'THIS_BATTLE'
      : /during this turn/i.test(raw)
      ? 'THIS_TURN'
      : 'CONTINUOUS',
    replacementSummary: raw,
    maxPerEventInstance: 1,
  };
}

// ---------------------------------------------------------------------------
// 5. Public Seam 1 Entry Point: parseCardAbilities(card, legacyClauses?)
// ---------------------------------------------------------------------------

export function parseCardAbilities(
  card: Pick<GundamCardPrint, 'cardNo' | 'effect'> &
    Partial<Pick<GundamCardPrint, 'traits' | 'link'>>,
  legacyClauses: EffectClause[] = []
): CfgParseResult {
  const normalized = normalizeCardEffectText(card.effect ?? '');
  if (!normalized) {
    return { cardNo: card.cardNo, keywords: [], abilities: [], errors: [] };
  }

  const lines = normalized.split(/\n+/).filter(Boolean);
  const keywords: KeywordAbility[] = [];
  const abilities: AbilityAst[] = [];
  const errors: string[] = [];

  let clauseIdx = 0;

  for (const line of lines) {
    const lexed = GundamLexer.tokenize(line);
    if (lexed.errors.length > 0) {
      errors.push(
        `[${card.cardNo}#${clauseIdx}] Lex error: ${lexed.errors.map((e) => e.message).join('; ')}`
      );
      clauseIdx += 1;
      continue;
    }

    clauseParser.input = lexed.tokens;
    const cst: CstNode = clauseParser.clauseLine();
    if (clauseParser.errors.length > 0) {
      errors.push(
        `[${card.cardNo}#${clauseIdx}] Parse error: ${clauseParser.errors.map((e) => e.message).join('; ')}`
      );
      clauseIdx += 1;
      continue;
    }

    if (cst.children.keywordOnlyUnit) {
      const kwNode = cst.children.keywordOnlyUnit[0] as CstNode;
      for (const tok of (kwNode.children.KeywordTag ?? []) as IToken[]) {
        const parsedKw = parseKeywordTag(tok.image);
        if (parsedKw) keywords.push(parsedKw);
      }
      continue;
    }

    const currentIdx = clauseIdx;
    clauseIdx += 1;

    const hookId = `${card.cardNo}#${currentIdx}`;
    const registeredHook = CUSTOM_HOOK_REGISTRY[hookId];
    if (registeredHook) {
      abilities.push({
        kind: 'CUSTOM_HOOK',
        clauseIndex: currentIdx,
        hookId: registeredHook.hookId,
        version: registeredHook.version,
        raw: line,
        prerequisites: registeredHook.prerequisites ?? [],
      });
      continue;
    }

    const legacyClause = legacyClauses[currentIdx];

    if (cst.children.replacementUnit) {
      abilities.push(liftReplacementEffect(currentIdx, line, legacyClause));
      continue;
    }

    if (cst.children.continuousUnit) {
      abilities.push(liftContinuousModifier(currentIdx, line, legacyClause));
      continue;
    }

    // Triggered / Activated Effect Clause
    const insteadMatch = line.match(/\bIf\s+([^,]+),\s*(.+?\binstead)\.?$/i);
    const timings: EffectTiming[] = legacyClause?.timings ?? inferFallbackTimings(line);
    abilities.push({
      kind: 'EFFECT_CLAUSE',
      clauseIndex: currentIdx,
      raw: legacyClause?.raw ?? line,
      timings,
      oncePerTurn: /【Once per Turn】/.test(line) || (legacyClause?.oncePerTurn ?? false),
      ...(legacyClause?.triggerEvent ? { triggerEvent: legacyClause.triggerEvent } : {}),
      ...(legacyClause?.linkRequirement ? { linkRequirement: legacyClause.linkRequirement } : {}),
      ...(legacyClause?.cost ? { cost: legacyClause.cost } : {}),
      ...(legacyClause?.condition ? { condition: legacyClause.condition } : {}),
      steps: legacyClause?.steps ?? [],
      ...(insteadMatch
        ? {
            insteadUpgrade: {
              rawUpgrade: insteadMatch[2].trim(),
            },
          }
        : {}),
    });
  }

  return {
    cardNo: card.cardNo,
    keywords,
    abilities,
    errors,
  };
}

function inferFallbackTimings(line: string): EffectTiming[] {
  const out: EffectTiming[] = [];
  if (/【Deploy/i.test(line)) out.push('DEPLOY');
  if (/【Attack】/i.test(line)) out.push('ATTACK');
  if (/【Destroyed】/i.test(line)) out.push('DESTROYED');
  if (/【When Paired】/i.test(line)) out.push('WHEN_PAIRED');
  if (/【When Linked】/i.test(line)) out.push('WHEN_LINKED');
  if (/【Burst】/i.test(line)) out.push('BURST');
  if (/【Activate<DOT>Main】/i.test(line)) out.push('ACTIVATE_MAIN');
  if (/【Activate<DOT>Action】/i.test(line)) out.push('ACTIVATE_ACTION');
  if (/【Main】/i.test(line)) out.push('MAIN');
  if (/【Action】/i.test(line)) out.push('ACTION');
  if (/When this Unit is attacked/i.test(line)) out.push('WHEN_ATTACKED');
  if (out.length === 0) out.push('CONTINUOUS');
  return out;
}
