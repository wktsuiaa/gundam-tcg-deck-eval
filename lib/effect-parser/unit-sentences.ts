import { parseDuration, parseScaleMetric } from './selectors.ts';
import { type SentenceContext } from './sentence-steps.ts';
import { extractAllTraits, parseKeywordToken } from './text-utils.ts';

export function parseDamageAndStatSentence(ctx: SentenceContext): boolean {
  const { s, state, resolveTarget } = ctx;
  // 16. Destroy / Deal damage
  const destM = s.match(/^destroy (.+?)(?: if .+)?\.?$/i);
  if (destM) {
    state.steps.push({ action: 'DESTROY', target: resolveTarget(destM[1]) });
    return true;
  }
  const dmgScaleM = s.match(/^deal (?:an amount of )?damage (?:to (.+?) )?equal to (.+?)(?: to (.+?))?\.?$/i);
  if (dmgScaleM && (dmgScaleM[1] || dmgScaleM[3])) {
    state.steps.push({
      action: 'DEAL_DAMAGE',
      amount: 1,
      scaleBy: parseScaleMetric(dmgScaleM[2]),
      target: resolveTarget(dmgScaleM[3] ?? dmgScaleM[1]),
    });
    return true;
  }
  const dmgM = s.match(/^deal (\d+) damage to (.+?)\.?$/i);
  if (dmgM) {
    state.steps.push({ action: 'DEAL_DAMAGE', amount: parseInt(dmgM[1], 10), target: resolveTarget(dmgM[2]) });
    return true;
  }

  // 17. Modify AP / HP (fixed & scaling) & Grant Keyword (fixed & scaling) & Grant Trait
  const apScaleM = s.match(/^(?:during [^,]+,\s*)?(increase|reduce)\s+(.+?)'?s?\s+AP\s+(?:during [^ ]+ [^ ]+\s+)?by an amount equal to (.+?)(?:\s+(during this turn|during this battle))?\.?$/i);
  if (apScaleM) {
    const sign = apScaleM[1].toLowerCase() === 'increase' ? 1 : -1;
    const dur = parseDuration(s);
    state.steps.push({
      action: 'MODIFY_AP',
      delta: sign,
      scaleBy: parseScaleMetric(apScaleM[3]),
      ...(dur ? { duration: dur } : {}),
      target: resolveTarget(apScaleM[2].replace(/'s?$/, '')),
    });
    return true;
  }
  const apM = s.match(/^(.+?)\s+gets?\s+AP\s*([+-]\d+)(.*)$/i);
  if (apM) {
    state.steps.push({
      action: 'MODIFY_AP',
      delta: parseInt(apM[2], 10),
      duration: parseDuration(apM[3]),
      target: resolveTarget(apM[1]),
    });
    return true;
  }
  const hpM = s.match(/^(.+?)\s+gets?\s+HP\s*([+-]\d+)(.*)$/i);
  if (hpM) {
    state.steps.push({
      action: 'MODIFY_HP',
      delta: parseInt(hpM[2], 10),
      duration: parseDuration(hpM[3]),
      target: resolveTarget(hpM[1]),
    });
    return true;
  }
  const kwScaleM = s.match(/^(?:during [^,]+,\s*)?(.+?)\s+gains the same number of\s*<([^>]+)>\s+as (.+?)\.?$/i);
  if (kwScaleM) {
    const kw = parseKeywordToken(kwScaleM[2]);
    if (kw) {
      state.steps.push({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        scaleBy: parseScaleMetric(kwScaleM[3]),
        duration: parseDuration(s),
        target: resolveTarget(kwScaleM[1]),
      });
      return true;
    }
  }
  const kwGrantM = s.match(/^(.+?)\s+(?:gains?|gets?)\s*<([^>]+)>(.*)$/i);
  if (kwGrantM) {
    const kw = parseKeywordToken(kwGrantM[2]);
    if (kw) {
      state.steps.push({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        duration: parseDuration(kwGrantM[3]),
        target: resolveTarget(kwGrantM[1]),
      });
      return true;
    }
  }
  const traitGrantM = s.match(/^(.+?)\s+gains?\s+(\([^)]+\))\.?$/i);
  if (traitGrantM) {
    state.steps.push({
      action: 'GRANT_TRAIT',
      traits: extractAllTraits(traitGrantM[2]),
      target: resolveTarget(traitGrantM[1]),
    });
    return true;
  }

  // 18. Recover HP
  const recM = s.match(/^(.+?)\s+recovers?\s+(\d+)\s+HP\.?$/i);
  if (recM) {
    state.steps.push({
      action: 'RECOVER_HP',
      amount: parseInt(recM[2], 10),
      target: resolveTarget(recM[1]),
    });
    return true;
  }
  return false;
}

export function parseBoardStateSentence(ctx: SentenceContext): boolean {
  const { s, state, resolveTarget } = ctx;
  // 19. Rest / Set active / Freeze / Return to hand or deck / Exile
  const restM = s.match(/^rest (.+?)\.?$/i);
  if (restM) {
    state.steps.push({ action: 'REST', target: resolveTarget(restM[1]) });
    return true;
  }
  const actM = s.match(/^set (.+?) as active\.?$/i);
  if (actM) {
    state.steps.push({ action: 'SET_ACTIVE', target: resolveTarget(actM[1]) });
    return true;
  }
  if (/won'\s*t be set as active/i.test(s)) {
    state.steps.push({ action: 'FREEZE', target: state.chosenTarget ?? { owner: 'ENEMY', cardType: 'UNIT', count: 1 } });
    return true;
  }
  const retHandM = s.match(/^return (.+?) to (?:its|their|your) (?:owners?'?s?\s*)?hands?\.?$/i);
  if (retHandM) {
    state.steps.push({ action: 'BOUNCE', target: resolveTarget(retHandM[1]) });
    return true;
  }
  const retDeckM = s.match(/^(?:they\s+)?return (?:it|them|any remaining card|(.+?)) to (?:(?:the (top|bottom|top or bottom) of )?(?:its|your|their) (?:owners?'?s? )?deck(?: and shuffle it)?|the top of your deck or place (?:it|them) into your trash)\.?$/i);
  if (retDeckM) {
    const tgt = retDeckM[1] ? resolveTarget(retDeckM[1]) : state.chosenTarget ?? { owner: 'SELF', cardType: 'CARD', zone: 'DECK', count: 1 };
    const pos = retDeckM[2]?.toUpperCase().includes('BOTTOM') ? 'BOTTOM' : 'TOP';
    state.steps.push({
      action: 'RETURN_TO_DECK',
      position: /shuffle/i.test(s) ? 'SHUFFLE' : pos,
      ...( /shuffle/i.test(s) ? { shuffle: true } : {} ),
      target: tgt,
    });
    return true;
  }
  if (/reveal .+? among them and (?:add (?:it|them) to your hand|return (?:it|them) to the top of your deck)/i.test(s)) {
    const traits = extractAllTraits(s);
    state.steps.push({
      action: 'LOOK_TOP',
      count: 1,
      revealSearch: true,
      ...(traits[0] ? { trait: traits[0] } : {}),
      ...( /return .* top/i.test(s) ? { remainderPosition: 'TOP' as const } : {} ),
    });
    return true;
  }
  const exileM = s.match(/^exile (.+?) from the game\.?$/i);
  if (exileM) {
    state.steps.push({ action: 'EXILE', target: resolveTarget(exileM[1]) });
    return true;
  }

  // 20. Resource ramp & Cost / Lv reduction
  const resM = s.match(/place (\d+) (?:rested |active )?(EX )?resources?/i);
  if (resM) {
    state.steps.push({
      action: 'ADD_RESOURCE',
      count: parseInt(resM[1], 10),
      ex: Boolean(resM[2]),
      rested: /rested/i.test(s),
    });
    return true;
  }
  const costRedHandM = s.match(/this card in your (hand|trash) gets Lv\.\s*-(\d+) and cost\s*-(\d+)(?:\s+for each (.+))?/i);
  if (costRedHandM) {
    state.steps.push({
      action: 'COST_REDUCTION',
      lvDelta: -parseInt(costRedHandM[2], 10),
      amount: parseInt(costRedHandM[3], 10),
      zone: costRedHandM[1].toUpperCase() as 'HAND' | 'TRASH',
      ...(costRedHandM[4] ? { perTarget: parseScaleMetric(costRedHandM[4]) } : {}),
    });
    return true;
  }
  const playAsM = s.match(/play (?:this card|it) as if it has (\d+) (?:Lv\. and cost|cost)/i);
  if (playAsM) {
    const n = parseInt(playAsM[1], 10);
    state.steps.push({
      action: 'COST_REDUCTION',
      amount: 0,
      exactCost: n,
      ...( /Lv\. and cost/i.test(s) ? { exactLv: n } : {} ),
    });
    return true;
  }
  const costRedM = s.match(/(?:reduce the cost|gets? cost\s*-(\d+)|it gets cost\s*-(\d+))/i);
  if (costRedM) {
    state.steps.push({ action: 'COST_REDUCTION', amount: parseInt(costRedM[1] ?? costRedM[2] ?? '1', 10) });
    return true;
  }
  return false;
}
