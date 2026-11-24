import type { CardColor, GundamCardPrint } from '@/types/gundam';

export type EffectTiming =
  | 'DEPLOY'
  | 'ATTACK'
  | 'DESTROYED'
  | 'WHEN_PAIRED'
  | 'WHEN_LINKED'
  | 'DURING_PAIR'
  | 'DURING_LINK'
  | 'BURST'
  | 'ACTIVATE_MAIN'
  | 'ACTIVATE_ACTION'
  | 'MAIN'
  | 'ACTION'
  | 'END_OF_TURN'
  | 'WHEN_PLAYING'
  | 'CONTINUOUS';

export type KeywordName =
  | 'Repair'
  | 'Breach'
  | 'Support'
  | 'Blocker'
  | 'First Strike'
  | 'High-Maneuver'
  | 'Suppression';

export interface KeywordAbility {
  name: KeywordName;
  value: number | null;
}

export interface TargetSelector {
  owner: 'ENEMY' | 'SELF' | 'ANY' | 'ALL_PLAYERS';
  self?: boolean;
  cardType?: 'UNIT' | 'PILOT' | 'BASE' | 'COMMAND' | 'SHIELD' | 'RESOURCE' | 'CARD';
  count?: number | 'ALL' | 'UP_TO';
  maxCount?: number;
  lvMin?: number;
  lvMax?: number;
  apMin?: number;
  apMax?: number;
  hpMax?: number;
  state?: 'ACTIVE' | 'RESTED' | 'DAMAGED';
  trait?: string;
  nameContains?: string;
  excludeName?: string;
  zone?: 'BATTLE_AREA' | 'TRASH' | 'HAND' | 'DECK' | 'SHIELD' | 'RESOURCE';
  other?: boolean;
}

export type EffectCondition =
  | { kind: 'DEPLOYED_FROM_ZONE'; zone: 'trash' | 'hand' }
  | { kind: 'TRASH_COUNT_AT_LEAST'; count: number; color?: CardColor; trait?: string; cardType?: string }
  | { kind: 'FRIENDLY_BASE_IN_PLAY' }
  | { kind: 'SELF_AP_AT_LEAST'; minAp: number }
  | { kind: 'UNIT_TRAIT_IS'; trait: string }
  | { kind: 'IS_YOUR_TURN' }
  | { kind: 'SELF_RESTED' }
  | { kind: 'DESTROYED_BY_BATTLE' }
  | { kind: 'UNIT_COUNT_AT_LEAST'; owner: 'ENEMY' | 'SELF' | 'ANY'; count: number }
  | { kind: 'DEVELOPMENT_EXILE'; count: number }
  | { kind: 'RAW_CONDITION'; text: string };

export interface ActivationCost {
  resourceCost?: number;
  restSelf?: boolean;
  returnSelfToDeckBottom?: boolean;
  destroySelf?: boolean;
  discardCount?: number;
  exileFromTrashCount?: number;
  raw?: string;
}

export type EffectDuration = 'THIS_TURN' | 'THIS_BATTLE' | 'NEXT_TURN' | 'CONTINUOUS';

export type EffectStep =
  | { action: 'ADD_SELF_TO_HAND' }
  | { action: 'DEPLOY_SELF' }
  | { action: 'ACTIVATE_MAIN_EFFECT' }
  | { action: 'DESTROY'; target: TargetSelector }
  | { action: 'DEAL_DAMAGE'; amount: number; target: TargetSelector }
  | { action: 'MODIFY_AP'; delta: number; duration?: EffectDuration; target: TargetSelector }
  | { action: 'MODIFY_HP'; delta: number; duration?: EffectDuration; target: TargetSelector }
  | { action: 'REST'; target: TargetSelector }
  | { action: 'SET_ACTIVE'; target: TargetSelector }
  | { action: 'FREEZE'; target: TargetSelector }
  | { action: 'BOUNCE'; target: TargetSelector }
  | { action: 'RETURN_TO_DECK'; position?: 'TOP' | 'BOTTOM' | 'SHUFFLE'; target: TargetSelector }
  | { action: 'DRAW'; count: number; bothPlayers?: boolean }
  | { action: 'DISCARD'; count: number }
  | { action: 'LOOK_TOP'; count: number; revealSearch?: boolean; trashRest?: boolean; trait?: string }
  | { action: 'REVEAL_TOP'; count: number }
  | { action: 'ADD_SHIELD_TO_HAND'; count: number }
  | { action: 'ADD_FROM_TRASH_TO_HAND'; target: TargetSelector }
  | { action: 'DEPLOY_FROM_TRASH'; free: boolean; rested?: boolean; target: TargetSelector }
  | { action: 'PAIR_SELF_FROM_TRASH'; target: TargetSelector }
  | { action: 'DEPLOY_TOKEN'; count: number; ap?: number; hp?: number; name?: string }
  | { action: 'RECOVER_HP'; amount: number; target: TargetSelector }
  | { action: 'GRANT_KEYWORD'; keyword: KeywordAbility; duration?: EffectDuration; target: TargetSelector }
  | { action: 'DAMAGE_PROOF'; summary: string; target?: TargetSelector }
  | { action: 'ADD_RESOURCE'; count: number; ex?: boolean; rested?: boolean }
  | { action: 'COST_REDUCTION'; amount: number; lvDelta?: number }
  | { action: 'CANT_ATTACK'; duration?: EffectDuration; target: TargetSelector }
  | { action: 'ALLOW_ATTACK_ACTIVE'; target: TargetSelector }
  | { action: 'MILL'; count: number }
  | { action: 'EXILE'; target: TargetSelector };

export interface EffectClause {
  raw: string;
  timings: EffectTiming[];
  oncePerTurn: boolean;
  pairFilter?: { trait?: string; color?: CardColor; lvMin?: number; lvMax?: number };
  cost?: ActivationCost;
  condition?: EffectCondition;
  steps: EffectStep[];
  unparsedResidual: string;
}

export interface ParsedCardEffects {
  cardNo: string;
  keywords: KeywordAbility[];
  clauses: EffectClause[];
}

const KEYWORD_NAMES: Record<string, KeywordName> = {
  repair: 'Repair',
  breach: 'Breach',
  support: 'Support',
  blocker: 'Blocker',
  'first strike': 'First Strike',
  'high-maneuver': 'High-Maneuver',
  suppression: 'Suppression',
};

const CIRCLED_NUMS: Record<string, number> = {
  '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
};

const COLORS: CardColor[] = ['Blue', 'Green', 'Red', 'Purple', 'White', 'Colorless'];

function parseKeywordToken(raw: string): KeywordAbility | null {
  const m = raw.trim().match(/^([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s*(\d+)?$/);
  if (!m) return null;
  const canonical = KEYWORD_NAMES[m[1].toLowerCase()];
  if (!canonical) return null;
  return { name: canonical, value: m[2] ? parseInt(m[2], 10) : null };
}

/** Strips parenthetical rules reminders while preserving (Trait) and token stat tokens. */
export function stripReminderText(effect: string): string {
  // Handle nested parens like "(Rest this Unit... AP+(specified amount) ...)" up to 2 levels
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

function parseHeaderTag(
  tag: string,
  timings: Set<EffectTiming>,
  meta: { oncePerTurn: boolean; pairFilter?: EffectClause['pairFilter']; devCost?: number }
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
      case 'Pilot': break;
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

function parseCost(rawCost: string): ActivationCost {
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
  if (exile) cost.exileFromTrashCount = parseInt(exile[1], 10);
  return cost;
}

function parseCondition(condText: string): EffectCondition {
  const c = condText.trim();
  if (/^if you deploy this unit from your trash$/i.test(c)) {
    return { kind: 'DEPLOYED_FROM_ZONE', zone: 'trash' };
  }
  if (/^if you deploy this unit from your hand$/i.test(c)) {
    return { kind: 'DEPLOYED_FROM_ZONE', zone: 'hand' };
  }
  const trashCount = c.match(/there are (\d+) or more (?:(blue|green|red|purple|white)\s+)?(?:\(([^)]+)\)\s+)?(?:([a-z]+)\s+)?cards? in your trash/i);
  if (trashCount) {
    const colRaw = trashCount[2];
    const color = colRaw
      ? ((colRaw[0].toUpperCase() + colRaw.slice(1).toLowerCase()) as CardColor)
      : undefined;
    return {
      kind: 'TRASH_COUNT_AT_LEAST',
      count: parseInt(trashCount[1], 10),
      color,
      trait: trashCount[3],
      cardType: trashCount[4]?.toUpperCase(),
    };
  }
  if (/a friendly base (?:is )?in play/i.test(c)) {
    return { kind: 'FRIENDLY_BASE_IN_PLAY' };
  }
  const selfAp = c.match(/this unit has (\d+) or more ap/i);
  if (selfAp) {
    return { kind: 'SELF_AP_AT_LEAST', minAp: parseInt(selfAp[1], 10) };
  }
  const traitUnit = c.match(/if this is a \(([^)]+)\) unit/i);
  if (traitUnit) {
    return { kind: 'UNIT_TRAIT_IS', trait: traitUnit[1] };
  }
  if (/it is your turn/i.test(c)) {
    return { kind: 'IS_YOUR_TURN' };
  }
  if (/this unit is rested/i.test(c)) {
    return { kind: 'SELF_RESTED' };
  }
  if (/destroyed with battle damage/i.test(c)) {
    return { kind: 'DESTROYED_BY_BATTLE' };
  }
  const unitCount = c.match(/(\d+) or more (enemy|friendly)?\s*units? (?:are|is) in play/i);
  if (unitCount) {
    const owner = unitCount[2]?.toLowerCase() === 'enemy' ? 'ENEMY' : unitCount[2]?.toLowerCase() === 'friendly' ? 'SELF' : 'ANY';
    return { kind: 'UNIT_COUNT_AT_LEAST', owner, count: parseInt(unitCount[1], 10) };
  }
  return { kind: 'RAW_CONDITION', text: c };
}

function parseTargetSelector(phrase: string): TargetSelector {
  const s = phrase.trim();
  const sel: TargetSelector = {
    owner: /\benemy\b|\bopponent'?s\b/i.test(s)
      ? 'ENEMY'
      : /\bfriendly\b|\byour\b|\bof your\b/i.test(s)
      ? 'SELF'
      : 'ANY',
  };

  if (/^this unit$/i.test(s) || /\bthis unit\b/i.test(s)) {
    sel.owner = 'SELF';
    sel.self = true;
    sel.cardType = 'UNIT';
  }
  if (/\bbases?\b/i.test(s)) sel.cardType = 'BASE';
  else if (/\bshields?\b/i.test(s)) sel.cardType = 'SHIELD';
  else if (/\bresources?\b/i.test(s)) sel.cardType = 'RESOURCE';
  else if (/\bpilots?\b/i.test(s)) sel.cardType = 'PILOT';
  else if (/\bcommands?\b/i.test(s)) sel.cardType = 'COMMAND';
  else if (/\bunits?\b/i.test(s)) sel.cardType = 'UNIT';
  else if (/\bcards?\b/i.test(s)) sel.cardType = 'CARD';

  if (/\ball\b/i.test(s)) sel.count = 'ALL';
  else {
    const rng = s.match(/\b(\d+)\s+to\s+(\d+)\b/i);
    const upTo = s.match(/\bup to (\d+)\b/i);
    const exact = s.match(/\b(\d+)\b/);
    if (rng) {
      sel.count = 'UP_TO';
      sel.maxCount = parseInt(rng[2], 10);
    } else if (upTo) {
      sel.count = 'UP_TO';
      sel.maxCount = parseInt(upTo[1], 10);
    } else if (exact && !/Lv\.|AP|HP/i.test(s.slice(Math.max(0, (exact.index ?? 0) - 4), (exact.index ?? 0) + 1))) {
      sel.count = parseInt(exact[1], 10);
    } else {
      sel.count = 1;
    }
  }

  if (/\bactive\b/i.test(s)) sel.state = 'ACTIVE';
  else if (/\brested\b/i.test(s)) sel.state = 'RESTED';
  else if (/\bdamaged\b/i.test(s)) sel.state = 'DAMAGED';

  if (/\bother\b/i.test(s)) sel.other = true;

  const lvMax = s.match(/Lv\.(\d+)\s+or\s+lower/i);
  if (lvMax) sel.lvMax = parseInt(lvMax[1], 10);
  const lvMin = s.match(/Lv\.(\d+)\s+or\s+higher/i);
  if (lvMin) sel.lvMin = parseInt(lvMin[1], 10);
  const lvEq = s.match(/that is Lv\.(\d+)(?!\s+or)/i);
  if (lvEq) {
    sel.lvMin = parseInt(lvEq[1], 10);
    sel.lvMax = parseInt(lvEq[1], 10);
  }

  const apMax = s.match(/(\d+)\s+or\s+less\s+AP/i);
  if (apMax) sel.apMax = parseInt(apMax[1], 10);
  const apMin = s.match(/(\d+)\s+or\s+more\s+AP/i);
  if (apMin) sel.apMin = parseInt(apMin[1], 10);
  const hpMax = s.match(/(\d+)\s+HP\s+or\s+less|(\d+)\s+or\s+less\s+HP/i);
  if (hpMax) sel.hpMax = parseInt(hpMax[1] ?? hpMax[2], 10);

  const traitM = s.match(/\(([^)]+)\)/);
  if (traitM) sel.trait = traitM[1].trim();
  const nameM = s.match(/with "([^"]+)" in its card name/i);
  if (nameM) sel.nameContains = nameM[1];
  const exclM = s.match(/without "([^"]+)" in its card name/i);
  if (exclM) sel.excludeName = exclM[1];

  if (/from your trash/i.test(s)) sel.zone = 'TRASH';
  else if (/from your hand/i.test(s)) sel.zone = 'HAND';
  else if (/shield/i.test(s)) sel.zone = 'SHIELD';

  return sel;
}

function parseDuration(s: string): EffectDuration | undefined {
  if (/during this battle/i.test(s)) return 'THIS_BATTLE';
  if (/during this turn|until the end of this turn|until end of turn/i.test(s)) return 'THIS_TURN';
  if (/opponent'?s next turn/i.test(s)) return 'NEXT_TURN';
  return undefined;
}

function parseSentenceSteps(
  sent: string,
  state: { chosenTarget?: TargetSelector; steps: EffectStep[]; residual: string[] }
) {
  let s = sent.replace(/^(?:Then,?\s*|Also,?\s*|If you do,?\s*|After activating this card'?s 【[^】]+】,?\s*)/i, '').trim();
  if (!s) return;

  // Strip conditional phrasing that leads into an action when a clause has chained steps
  const mIfThen = s.match(/^(?:If this effect [^,]+|When [^,]+|During [^,]+|On the turn [^,]+),\s*(.+)$/i);
  if (mIfThen) s = mIfThen[1].trim();

  if (/^add this card to your hand\.?$/i.test(s)) {
    state.steps.push({ action: 'ADD_SELF_TO_HAND' });
    return;
  }
  if (/^deploy this card\.?$/i.test(s)) {
    state.steps.push({ action: 'DEPLOY_SELF' });
    return;
  }
  if (/^activate (?:this card'?s )?【(?:Main|Action)】/i.test(s) || /^activate 【(?:Main|Action)】 on /i.test(s)) {
    state.steps.push({ action: 'ACTIVATE_MAIN_EFFECT' });
    return;
  }

  // Handle "You may <sub-action>"
  const mayM = s.match(/^you may\s+(.+)$/i);
  if (mayM) s = mayM[1].trim();

  // "Choose <target>." (sets chosenTarget, and may carry inline action like "Choose 1 enemy Unit and rest it")
  const chooseOnly = s.match(/^(?:all enemy players each |all players each )?choose (.+?)\.?$/i);
  if (chooseOnly && !/\b(destroy|deal|rest|set|return|deploy|add|recover|gains?|gets?)\b/i.test(chooseOnly[1])) {
    const sel = parseTargetSelector(chooseOnly[1]);
    if (/^all enemy players/i.test(s)) sel.owner = 'ENEMY';
    state.chosenTarget = sel;
    return;
  }

  // Resolve target helper: inline target or bound anaphora (it / them / that Unit)
  const resolveTarget = (phrase: string): TargetSelector => {
    const p = phrase.trim();
    if (/^(it|they|them|that unit|that card|those units)$/i.test(p) && state.chosenTarget) {
      return state.chosenTarget;
    }
    if (/^this unit$/i.test(p)) return { owner: 'SELF', self: true, cardType: 'UNIT' };
    return parseTargetSelector(p);
  };

  // Draw N
  const drawM = s.match(/^(?:you and .*? )?draw (\d+)(?: cards?)?\.?$/i);
  if (drawM) {
    state.steps.push({ action: 'DRAW', count: parseInt(drawM[1], 10), bothPlayers: /you and/i.test(s) });
    return;
  }

  // Discard N
  const discM = s.match(/^discard (\d+)(?: cards?)?\.?$/i);
  if (discM) {
    state.steps.push({ action: 'DISCARD', count: parseInt(discM[1], 10) });
    return;
  }

  // Look at top N / Reveal top N
  const lookM = s.match(/look at the top (\d+) cards? of your deck/i);
  if (lookM) {
    const traitM = s.match(/\(([^)]+)\)/);
    state.steps.push({
      action: 'LOOK_TOP',
      count: parseInt(lookM[1], 10),
      revealSearch: /reveal|add/i.test(s),
      trashRest: /into your trash/i.test(s),
      trait: traitM?.[1],
    });
    return;
  }
  const revM = s.match(/reveal the top (\d+) cards? of your deck/i);
  if (revM) {
    state.steps.push({ action: 'REVEAL_TOP', count: parseInt(revM[1], 10) });
    return;
  }

  // Add 1 of your Shields to your hand
  if (/add (\d+) of your shields to your hand/i.test(s)) {
    const m = s.match(/add (\d+)/i);
    state.steps.push({ action: 'ADD_SHIELD_TO_HAND', count: m ? parseInt(m[1], 10) : 1 });
    return;
  }

  // Deploy from trash (including "Choose ... from your trash. Deploy it." or "Pay its cost to deploy it.")
  if (/^pay its cost to deploy it\.?$/i.test(s) && state.chosenTarget) {
    state.steps.push({ action: 'DEPLOY_FROM_TRASH', free: false, target: state.chosenTarget });
    return;
  }
  if (/^deploy (it|them)(?: rested)?\.?$/i.test(s) && state.chosenTarget) {
    state.steps.push({
      action: state.chosenTarget.zone === 'TRASH' ? 'DEPLOY_FROM_TRASH' : 'DEPLOY_TOKEN',
      free: true,
      rested: /rested/i.test(s),
      target: state.chosenTarget,
    } as EffectStep);
    return;
  }

  // Add from trash to hand ("Add it to your hand." after trash choose)
  if (/^add (it|them) to your hand\.?$/i.test(s) && state.chosenTarget) {
    if (state.chosenTarget.zone === 'TRASH') {
      state.steps.push({ action: 'ADD_FROM_TRASH_TO_HAND', target: state.chosenTarget });
    } else {
      state.steps.push({ action: 'LOOK_TOP', count: 1, revealSearch: true });
    }
    return;
  }

  // Destroy
  const destM = s.match(/^destroy (.+?)(?: if .+)?\.?$/i);
  if (destM) {
    state.steps.push({ action: 'DESTROY', target: resolveTarget(destM[1]) });
    return;
  }

  // Deal damage
  const dmgM = s.match(/^deal (\d+) damage to (.+?)\.?$/i);
  if (dmgM) {
    state.steps.push({
      action: 'DEAL_DAMAGE',
      amount: parseInt(dmgM[1], 10),
      target: resolveTarget(dmgM[2]),
    });
    return;
  }

  // Modify AP / HP / Grant Keyword ("It gets AP-3...", "This Unit gains <Suppression>", "All other ... get AP+1")
  const apM = s.match(/^(.+?)\s+gets?\s+AP\s*([+-]\d+)(.*)$/i);
  if (apM) {
    state.steps.push({
      action: 'MODIFY_AP',
      delta: parseInt(apM[2], 10),
      duration: parseDuration(apM[3]),
      target: resolveTarget(apM[1]),
    });
    return;
  }
  const kwGrantM = s.match(/^(.+?)\s+gains?\s*<([^>]+)>(.*)$/i);
  if (kwGrantM) {
    const kw = parseKeywordToken(kwGrantM[2]);
    if (kw) {
      state.steps.push({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        duration: parseDuration(kwGrantM[3]),
        target: resolveTarget(kwGrantM[1]),
      });
      return;
    }
  }

  // Recover HP
  const recM = s.match(/^(.+?)\s+recovers?\s+(\d+)\s+HP\.?$/i);
  if (recM) {
    state.steps.push({
      action: 'RECOVER_HP',
      amount: parseInt(recM[2], 10),
      target: resolveTarget(recM[1]),
    });
    return;
  }

  // Rest / Set active / Freeze
  const restM = s.match(/^rest (.+?)\.?$/i);
  if (restM) {
    state.steps.push({ action: 'REST', target: resolveTarget(restM[1]) });
    return;
  }
  const actM = s.match(/^set (.+?) as active\.?$/i);
  if (actM) {
    state.steps.push({ action: 'SET_ACTIVE', target: resolveTarget(actM[1]) });
    return;
  }
  if (/won'?t be set as active/i.test(s)) {
    state.steps.push({ action: 'FREEZE', target: state.chosenTarget ?? { owner: 'ENEMY', cardType: 'UNIT', count: 1 } });
    return;
  }

  // Return to hand (Bounce) or deck / Exile / Reveal-search
  const retHandM = s.match(/^return (.+?) to (?:its|their) owners?'?s? hands?\.?$/i);
  if (retHandM) {
    state.steps.push({ action: 'BOUNCE', target: resolveTarget(retHandM[1]) });
    return;
  }
  const retDeckM = s.match(/^return (.+?) to the (top|bottom|top or bottom) of (?:its|your|their) (?:owners?'?s? )?deck/i);
  if (retDeckM) {
    state.steps.push({
      action: 'RETURN_TO_DECK',
      position: retDeckM[2].toUpperCase().includes('BOTTOM') ? 'BOTTOM' : 'TOP',
      target: resolveTarget(retDeckM[1]),
    });
    return;
  }
  if (/reveal .+? among them and add (?:it|them) to your hand/i.test(s)) {
    const traitM = s.match(/\(([^)]+)\)/);
    state.steps.push({ action: 'LOOK_TOP', count: 1, revealSearch: true, trait: traitM?.[1] });
    return;
  }
  const exileM = s.match(/^exile (.+?) from the game\.?$/i);
  if (exileM) {
    state.steps.push({ action: 'EXILE', target: resolveTarget(exileM[1]) });
    return;
  }

  // Deploy token
  const tokM = s.match(/deploy (\d+) .*?\bunit tokens?\b/i);
  if (tokM) {
    const apM2 = s.match(/AP(\d+)/i);
    const hpM2 = s.match(/HP(\d+)/i);
    state.steps.push({
      action: 'DEPLOY_TOKEN',
      count: parseInt(tokM[1], 10),
      ap: apM2 ? parseInt(apM2[1], 10) : 2,
      hp: hpM2 ? parseInt(hpM2[1], 10) : 2,
    });
    return;
  }

  // Resource ramp / Cost reduction
  const resM = s.match(/place (\d+) (?:rested |active )?(EX )?resources?/i);
  if (resM) {
    state.steps.push({
      action: 'ADD_RESOURCE',
      count: parseInt(resM[1], 10),
      ex: Boolean(resM[2]),
      rested: /rested/i.test(s),
    });
    return;
  }
  const costRedM = s.match(/(?:reduce the cost|gets? cost\s*-(\d+)|play it as if it has)/i);
  if (costRedM) {
    state.steps.push({ action: 'COST_REDUCTION', amount: costRedM[1] ? parseInt(costRedM[1], 10) : 1 });
    return;
  }

  // Damage proof / protection / attack restrictions
  if (/reduce.*damage|take no damage|can'?t receive (?:battle |effect )?damage|cannot be damaged|cannot be destroyed|cannot be chosen|can'?t activate <Blocker>|change .* attack target/i.test(s)) {
    state.steps.push({ action: 'DAMAGE_PROOF', summary: s, ...(state.chosenTarget ? { target: state.chosenTarget } : {}) });
    return;
  }

  // Can't attack / Allow attacking active units / Pair from trash
  if (/can'?t attack|can'?t choose the enemy player as its attack target/i.test(s)) {
    state.steps.push({
      action: 'CANT_ATTACK',
      duration: parseDuration(s),
      target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
    });
    return;
  }
  if (/may choose (?:an? )?(?:damaged )?(?:active|rested) enemy unit/i.test(s)) {
    state.steps.push({
      action: 'ALLOW_ATTACK_ACTIVE',
      target: state.chosenTarget?.owner === 'SELF' ? state.chosenTarget : parseTargetSelector(s),
    });
    return;
  }
  if (/pair this card from your trash/i.test(s)) {
    const sel = parseTargetSelector(s);
    state.steps.push({
      action: 'PAIR_SELF_FROM_TRASH',
      target: { ...sel, owner: 'SELF', cardType: 'UNIT', zone: 'BATTLE_AREA' },
    });
    return;
  }

  // Trash / mill
  if (/place (?:the top |the remaining )?(?:\d+ )?cards?.*into your trash/i.test(s)) {
    const m = s.match(/(\d+)/);
    state.steps.push({ action: 'MILL', count: m ? parseInt(m[1], 10) : 1 });
    return;
  }

  // Compound "Choose X and <action>" or "It gets ... and ..."
  if (/\bChoose\b/i.test(s) && /\.\s*/.test(s) === false) {
    const parts = s.split(/\s+and\s+/i);
    if (parts.length > 1) {
      for (const p of parts) parseSentenceSteps(p, state);
      return;
    }
  }

  state.residual.push(sent);
}

/** Parses raw card.effect into innately granted Keyword Abilities and fail-closed Effect Clauses. */
export function parseCardEffects(card: Pick<GundamCardPrint, 'cardNo' | 'effect'>): ParsedCardEffects {
  const rawEffect = card.effect || '';
  if (!rawEffect.trim() || rawEffect.trim() === '-') {
    return { cardNo: card.cardNo, keywords: [], clauses: [] };
  }

  const cleaned = stripReminderText(rawEffect);
  const rawLines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Merge Development bullet lines (■...) with their preceding Development header
  const mergedLines: string[] = [];
  for (const line of rawLines) {
    if (line.startsWith('■') && mergedLines.length > 0 && /activate the following effect:$/i.test(mergedLines[mergedLines.length - 1])) {
      mergedLines[mergedLines.length - 1] = `${mergedLines[mergedLines.length - 1]} ${line.slice(1).trim()}`;
    } else {
      mergedLines.push(line.replace(/^■\s*/, ''));
    }
  }

  const keywords: KeywordAbility[] = [];
  const clauses: EffectClause[] = [];

  for (const line of mergedLines) {
    let rest = line;
    const timings = new Set<EffectTiming>();
    const meta: { oncePerTurn: boolean; pairFilter?: EffectClause['pairFilter']; devCost?: number } = {
      oncePerTurn: false,
    };

    // 1. Parse leading 【...】 headers (supporting "/" between timings e.g. 【Main】/【Action】)
    while (true) {
      const m = rest.match(/^(?:\/\s*)?(【[^】]+】)\s*/);
      if (!m) break;
      parseHeaderTag(m[1], timings, meta);
      rest = rest.slice(m[0].length).trim();
    }

    // 2. Parse leading innate <Keyword> tokens (e.g. "<Blocker> <Repair 1>")
    const lineKeywords: KeywordAbility[] = [];
    while (true) {
      const m = rest.match(/^<([^>]+)>\s*/);
      if (!m) break;
      const kw = parseKeywordToken(m[1]);
      if (!kw) break;
      lineKeywords.push(kw);
      rest = rest.slice(m[0].length).trim();
    }
    if (timings.size === 0) {
      keywords.push(...lineKeywords);
    }

    if (!rest) {
      // Pure keyword line or conditional keyword inside a timing header
      if (timings.size > 0 && lineKeywords.length > 0) {
        clauses.push({
          raw: line,
          timings: [...timings],
          oncePerTurn: meta.oncePerTurn,
          pairFilter: meta.pairFilter,
          steps: lineKeywords.map((kw) => ({
            action: 'GRANT_KEYWORD',
            keyword: kw,
            target: { owner: 'SELF', self: true, cardType: 'UNIT' },
          })),
          unparsedResidual: '',
        });
      }
      continue;
    }

    // 3. Split optional activation cost on ：
    let cost: ActivationCost | undefined;
    const colonIdx = rest.indexOf('：');
    if (colonIdx !== -1) {
      cost = parseCost(rest.slice(0, colonIdx).trim());
      rest = rest.slice(colonIdx + 1).trim();
    }

    // 4. Development condition block
    let condition: EffectCondition | undefined;
    const devBody = rest.match(/^You may exile the specified number of .*?activate the following effect:\s*(.+)$/i);
    if (devBody) {
      condition = { kind: 'DEVELOPMENT_EXILE', count: meta.devCost ?? 1 };
      rest = devBody[1].trim();
    }

    // 5. Timing phrases like "During your turn," / "At the end of your turn," / "When playing this card..."
    if (/^At the end of your turn,\s*/i.test(rest)) {
      timings.add('END_OF_TURN');
      rest = rest.replace(/^At the end of your turn,\s*/i, '');
    } else if (/^When playing this card(?: from your hand)?,\s*/i.test(rest)) {
      timings.add('WHEN_PLAYING');
      rest = rest.replace(/^When playing this card(?: from your hand)?,\s*/i, '');
    } else if (/^During your turn,\s*/i.test(rest)) {
      if (timings.size === 0) timings.add('CONTINUOUS');
      rest = rest.replace(/^During your turn,\s*/i, '');
    }

    if (timings.size === 0) timings.add('CONTINUOUS');

    // 6. Split sentences (avoiding breaking on "Lv.") and extract leading If/While condition
    const sentences = rest
      .split(/(?<!\bLv)\.(?=\s+|$)/)
      .map((x) => x.trim())
      .filter(Boolean);

    const parseState: { chosenTarget?: TargetSelector; steps: EffectStep[]; residual: string[] } = {
      steps: lineKeywords.map((kw) => ({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      })),
      residual: [],
    };

    sentences.forEach((sent, idx) => {
      let body = sent;
      if (idx === 0 && !condition) {
        const condM = body.match(/^((?:If|While)\s+[^,]+),\s*(.+)$/i);
        if (condM) {
          condition = parseCondition(condM[1]);
          body = condM[2].trim();
        }
      }
      parseSentenceSteps(body, parseState);
    });

    clauses.push({
      raw: line,
      timings: [...timings],
      oncePerTurn: meta.oncePerTurn,
      pairFilter: meta.pairFilter,
      ...(cost ? { cost } : {}),
      ...(condition ? { condition } : {}),
      steps: parseState.steps,
      unparsedResidual: parseState.residual.join(' '),
    });
  }

  return { cardNo: card.cardNo, keywords, clauses };
}

export type SynergyNodeKey =
  | 'DEPLOY_FROM_TRASH'
  | 'TRASH_COUNT_FUEL'
  | 'AP_THRESHOLD_5'
  | 'DAMAGED_ENEMY_TARGET'
  | 'RESTED_ENEMY_TARGET';

export interface CardSynergyProfile {
  requires: SynergyNodeKey[];
  enables: SynergyNodeKey[];
}

/** Derives high-signal Enabler <-> Payoff Knowledge Map edges from parsed Effect Clauses. */
export function extractSynergyProfile(
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'ap' | 'effect'>,
  parsed = parseCardEffects(card)
): CardSynergyProfile {
  const requires = new Set<SynergyNodeKey>();
  const enables = new Set<SynergyNodeKey>();

  for (const clause of parsed.clauses) {
    if (clause.condition?.kind === 'DEPLOYED_FROM_ZONE' && clause.condition.zone === 'trash') {
      requires.add('DEPLOY_FROM_TRASH');
    }
    if (clause.condition?.kind === 'TRASH_COUNT_AT_LEAST') {
      requires.add('TRASH_COUNT_FUEL');
    }
    if (clause.condition?.kind === 'SELF_AP_AT_LEAST' && clause.condition.minAp >= 5) {
      requires.add('AP_THRESHOLD_5');
    }

    for (const step of clause.steps) {
      if (step.action === 'DEPLOY_FROM_TRASH') enables.add('DEPLOY_FROM_TRASH');
      if (step.action === 'DISCARD' || step.action === 'MILL' || (step.action === 'LOOK_TOP' && step.trashRest)) {
        enables.add('TRASH_COUNT_FUEL');
      }
      if (step.action === 'MODIFY_AP' && step.delta > 0 && step.target.owner === 'SELF') {
        enables.add('AP_THRESHOLD_5');
      }
      if (step.action === 'DEAL_DAMAGE' && step.target.owner === 'ENEMY') {
        enables.add('DAMAGED_ENEMY_TARGET');
      }
      if (step.action === 'REST' && step.target.owner === 'ENEMY') {
        enables.add('RESTED_ENEMY_TARGET');
      }
      if ('target' in step && step.target && step.target.owner === 'ENEMY') {
        if (step.target.state === 'DAMAGED') requires.add('DAMAGED_ENEMY_TARGET');
        if (step.target.state === 'RESTED') requires.add('RESTED_ENEMY_TARGET');
      }
    }
  }

  if (parsed.keywords.some((k) => k.name === 'Support') || (card.type === 'PILOT' && (card.ap ?? 0) >= 1)) {
    enables.add('AP_THRESHOLD_5');
  }

  return { requires: [...requires], enables: [...enables] };
}

export interface EffectPrerequisite {
  kind: 'TRAIT' | 'COLOR' | 'CARD_TYPE' | 'NAME';
  trait?: string;
  color?: CardColor;
  cardType?: 'UNIT' | 'PILOT' | 'BASE' | 'COMMAND' | 'CARD';
  nameContains?: string;
  minCopies: 4 | 8;
  primaryClause: boolean;
  reason: string;
}

function isNonFunctionalTag(clause: EffectClause): boolean {
  return clause.steps.length === 0 && !clause.condition && !clause.pairFilter;
}

/** Extracts deck-composition Effect Prerequisites (4 copies for single-target/pair, 8 for density/search/mill-scale). */
export function extractEffectPrerequisites(
  card: Pick<GundamCardPrint, 'cardNo' | 'type' | 'ap' | 'effect'>,
  parsed = parseCardEffects(card)
): EffectPrerequisite[] {
  const functionalClauses = parsed.clauses.filter((c) => !isNonFunctionalTag(c));
  const hasInnateKeyword = parsed.keywords.length > 0;
  const collected = new Map<string, EffectPrerequisite>();

  const perClause = functionalClauses.map((clause) => {
    const isBurstOnly = clause.timings.length === 1 && clause.timings[0] === 'BURST';
    const clausePrereqs: Omit<EffectPrerequisite, 'primaryClause'>[] = [];
    let hasUnrestrictedStep = false;

    // 1. Pair filter on header e.g. 【During Pair･(Coordinator) Pilot】 or 【When Paired･Purple Pilot】
    if (clause.pairFilter && (clause.pairFilter.trait || clause.pairFilter.color)) {
      const parts = [clause.pairFilter.color, clause.pairFilter.trait ? `(${clause.pairFilter.trait})` : undefined, 'Pilot'].filter(Boolean);
      clausePrereqs.push({
        kind: clause.pairFilter.trait ? 'TRAIT' : 'COLOR',
        trait: clause.pairFilter.trait,
        color: clause.pairFilter.color,
        cardType: 'PILOT',
        minCopies: 4,
        reason: `Requires ${parts.join(' ')}`,
      });
    }

    // 2. Clause condition
    if (clause.condition) {
      const cond = clause.condition;
      if (cond.kind === 'TRASH_COUNT_AT_LEAST' && (cond.trait || cond.color || cond.cardType)) {
        const ct = cond.cardType === 'UNIT' || cond.cardType === 'PILOT' || cond.cardType === 'BASE' || cond.cardType === 'COMMAND' ? cond.cardType : undefined;
        const label = [cond.color, cond.trait ? `(${cond.trait})` : undefined, ct].filter(Boolean).join(' ');
        clausePrereqs.push({
          kind: cond.trait ? 'TRAIT' : cond.color ? 'COLOR' : 'CARD_TYPE',
          trait: cond.trait,
          color: cond.color,
          cardType: ct,
          minCopies: 8,
          reason: `Requires ${cond.count}+ ${label} cards in trash`,
        });
      } else if (cond.kind === 'UNIT_TRAIT_IS') {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: cond.trait,
          cardType: 'UNIT',
          minCopies: 4,
          reason: `Requires (${cond.trait}) Unit`,
        });
      } else if (cond.kind === 'RAW_CONDITION') {
        const traitM = cond.text.match(/\(([^)]+)\)/);
        if (traitM) {
          const trait = traitM[1].trim();
          clausePrereqs.push({
            kind: 'TRAIT',
            trait,
            cardType: /\bunit\b/i.test(cond.text) ? 'UNIT' : /\bpilot\b/i.test(cond.text) ? 'PILOT' : undefined,
            minCopies: 4,
            reason: `Requires (${trait})`,
          });
        }
      }
    }

    // 3. Clause steps
    const stepHasGate = Boolean(clause.pairFilter || (clause.condition && clausePrereqs.length > 0));
    for (const step of clause.steps) {
      if (step.action === 'LOOK_TOP' && step.trait) {
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: step.trait,
          minCopies: 8,
          reason: `Searches (${step.trait}) cards`,
        });
      } else if ('target' in step && step.target && step.target.owner === 'SELF' && (step.target.trait || step.target.nameContains)) {
        const t = step.target;
        const isTrashDensity = step.action === 'DEPLOY_FROM_TRASH' || step.action === 'ADD_FROM_TRASH_TO_HAND';
        const minCopies: 4 | 8 = isTrashDensity && t.trait ? 8 : 4;
        const ct =
          t.cardType === 'UNIT' || t.cardType === 'PILOT' || t.cardType === 'BASE' || t.cardType === 'COMMAND'
            ? t.cardType
            : undefined;
        if (t.trait) {
          clausePrereqs.push({
            kind: 'TRAIT',
            trait: t.trait,
            cardType: ct,
            minCopies,
            reason: `Requires (${t.trait})${ct ? ` ${ct}` : ''} target`,
          });
        } else if (t.nameContains) {
          clausePrereqs.push({
            kind: 'NAME',
            nameContains: t.nameContains,
            cardType: ct,
            minCopies,
            reason: `Requires "${t.nameContains}"${ct ? ` ${ct}` : ''}`,
          });
        }
      } else if (!stepHasGate && step.action !== 'ACTIVATE_MAIN_EFFECT') {
        hasUnrestrictedStep = true;
      }
    }

    // 4. Residual trait scaling & friendly (Trait) phrase fallback
    const scaleTargetText = clause.unparsedResidual || clause.raw;
    const scaleMatch = scaleTargetText.match(/equal to the number of (?:friendly )?\(([^)]+)\)/i);
    if (scaleMatch) {
      const trait = scaleMatch[1].trim();
      clausePrereqs.push({
        kind: 'TRAIT',
        trait,
        minCopies: 8,
        reason: `Scales damage/effect with (${trait}) density`,
      });
    }
    const friendlyMatch = clause.raw.match(
      /(?:friendly|of your|have a)\s+(?:other\s+|rested\s+|active\s+)?\(([^)]+)\)\s*(?:Link\s+)?(Units?|Pilots?|Bases?|Commands?|cards?)/i
    );
    if (friendlyMatch) {
      const fTrait = friendlyMatch[1].trim();
      if (!clausePrereqs.some((p) => p.trait?.toLowerCase() === fTrait.toLowerCase())) {
        const typeRaw = friendlyMatch[2].toUpperCase().replace(/S$/, '');
        const ct =
          typeRaw === 'UNIT' || typeRaw === 'PILOT' || typeRaw === 'BASE' || typeRaw === 'COMMAND'
            ? typeRaw
            : undefined;
        clausePrereqs.push({
          kind: 'TRAIT',
          trait: fTrait,
          cardType: ct,
          minCopies: 4,
          reason: `Requires (${fTrait})${ct ? ` ${ct}` : ''} target`,
        });
      }
    }

    return { isBurstOnly, clausePrereqs, hasUnrestrictedStep };
  });

  const nonBurstClauses = perClause.filter((c) => !c.isBurstOnly);
  const hasUnrestrictedActiveClause = nonBurstClauses.some((c) => c.hasUnrestrictedStep || c.clausePrereqs.length === 0);

  for (const c of perClause) {
    const isPrimary = !hasInnateKeyword && !c.isBurstOnly && !c.hasUnrestrictedStep && !hasUnrestrictedActiveClause;
    for (const p of c.clausePrereqs) {
      const key = `${p.kind}|${p.trait ?? ''}|${p.color ?? ''}|${p.cardType ?? ''}|${p.nameContains ?? ''}`;
      const prev = collected.get(key);
      if (!prev) {
        collected.set(key, { ...p, primaryClause: isPrimary });
      } else if (isPrimary && !prev.primaryClause) {
        collected.set(key, { ...p, primaryClause: true });
      } else if (isPrimary === prev.primaryClause) {
        prev.minCopies = prev.minCopies === 8 || p.minCopies === 8 ? 8 : 4;
      }
    }
  }

  return [...collected.values()];
}
