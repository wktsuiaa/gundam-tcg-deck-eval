import { parseDuration, parseTargetSelector } from './selectors.ts';
import { type SentenceContext, parseSentenceSteps } from './sentence-steps.ts';

export function parseBattleSentence(ctx: SentenceContext): boolean {
  const { s, state, resolveTarget } = ctx;
  // 21. Battle damage redirection, damage dealt modifier, damage proof
  const redirDmgM = s.match(/^(?:during [^,]+,\s*)?battle damage (.+?) would receive is dealt to (.+?) instead\.?$/i);
  if (redirDmgM) {
    state.steps.push({
      action: 'REDIRECT_BATTLE_DAMAGE',
      fromTarget: resolveTarget(redirDmgM[1]),
      toTarget: resolveTarget(redirDmgM[2]),
      duration: parseDuration(s),
    });
    return true;
  }
  const modDmgDealtM = s.match(/^increase the damage dealt by (\d+)\.?$/i);
  if (modDmgDealtM) {
    state.steps.push({ action: 'MODIFY_DAMAGE_DEALT', delta: parseInt(modDmgDealtM[1], 10) });
    return true;
  }
  if (/reduce (?:it|the next damage.*|.*damage.*) by (\d+)|doesn't receive that damage|take no damage|can'?t receive (?:battle |effect |\d+ or less )?.*damage|cannot be damaged|cannot be destroyed|can'?t be destroyed|cannot be chosen|can'?t activate <Blocker>|change .* attack target|AP can'?t be reduced/i.test(s)) {
    const amtM = s.match(/reduce (?:it|the next damage.*|.*damage.*) by (\d+)/i);
    const maxDmgM = s.match(/(\d+) or less enemy (?:effect |battle )?damage/i);
    state.steps.push({
      action: 'DAMAGE_PROOF',
      summary: s,
      ...(amtM ? { amount: parseInt(amtM[1], 10) } : {}),
      ...(maxDmgM ? { maxDamage: parseInt(maxDmgM[1], 10) } : {}),
      damageType: /battle damage/i.test(s) ? 'BATTLE' : /effect damage/i.test(s) ? 'EFFECT' : 'ANY',
      duration: parseDuration(s),
      ...(state.chosenTarget ? { target: state.chosenTarget } : {}),
    });
    return true;
  }

  // 22. Forced battle damage step
  const battleStepBetweenM = s.match(/^begin a battle between them and only perform the damage step\.?$/i);
  if (battleStepBetweenM) {
    state.steps.push({
      action: 'FORCE_BATTLE_DAMAGE_STEP',
      attacker: { owner: 'SELF', cardType: 'UNIT', count: 1 },
      defender: { owner: 'ENEMY', cardType: 'UNIT', count: 1 },
    });
    return true;
  }
  const battleStepM = s.match(/begin a battle between (.+?) and (.+?) and only perform the damage step/i);
  if (battleStepM) {
    state.steps.push({
      action: 'FORCE_BATTLE_DAMAGE_STEP',
      attacker: resolveTarget(battleStepM[1]),
      defender: resolveTarget(battleStepM[2]),
    });
    return true;
  }

  // 23. Attack target redirection & restrictions
  const mustAtkM = s.match(/^(?:during [^,]+,\s*)?(all )?(enemy units.*) (?:must )?choose (.+?) as their attack target(?:\s+if possible)?(?:\s+when attacking)?\.?$/i);
  if (mustAtkM) {
    state.steps.push({
      action: 'REDIRECT_ATTACK_TARGET',
      rule: 'MUST_ATTACK_TARGET',
      attackerFilter: parseTargetSelector(`${mustAtkM[1] ?? ''}${mustAtkM[2]}`),
      target: resolveTarget(mustAtkM[3]),
      duration: parseDuration(s),
    });
    return true;
  }
  const cantChooseAtkM = s.match(/enemy units can'?t choose (.+?) as their attack target/i);
  if (cantChooseAtkM) {
    state.steps.push({
      action: 'REDIRECT_ATTACK_TARGET',
      rule: 'CANT_CHOOSE_TARGET',
      target: resolveTarget(cantChooseAtkM[1]),
      duration: parseDuration(s),
    });
    return true;
  }
  if (/can'?t choose the same enemy player/i.test(s)) {
    state.steps.push({
      action: 'REDIRECT_ATTACK_TARGET',
      rule: 'CANT_CHOOSE_SAME_PLAYER',
      target: { owner: 'ENEMY', cardType: 'CARD', count: 1 },
      duration: parseDuration(s),
    });
    return true;
  }
  if (/can'?t be paired with a pilot or attack/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_BE_PAIRED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    state.steps.push({ action: 'CANT_ATTACK', target: { owner: 'SELF', self: true, cardType: 'UNIT' } });
    return true;
  }
  if (/can'?t be set as active or paired with a pilot/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_SET_ACTIVE', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_BE_PAIRED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    return true;
  }
  if (/can'?t be paired with a pilot/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_BE_PAIRED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    return true;
  }
  if (/can'?t be set as active by enemy effects/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CANT_SET_ACTIVE', target: { owner: 'ENEMY', cardType: 'UNIT', count: 'ALL' }, summary: s });
    return true;
  }
  if (/may attack on the turn it is deployed/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'CAN_ATTACK_TURN_DEPLOYED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    return true;
  }
  if (/can only attack during a turn when/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'ONLY_ATTACK_WHEN_DEPLOYED', target: { owner: 'SELF', self: true, cardType: 'UNIT' }, summary: s });
    return true;
  }
  if (/are deployed rested/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'DEPLOYED_RESTED', target: parseTargetSelector(s), summary: s });
    return true;
  }
  if (/rest this base instead/i.test(s)) {
    state.steps.push({ action: 'RESTRICTION', rule: 'INSTEAD_REST_TARGET', target: { owner: 'SELF', self: true, cardType: 'BASE' }, summary: s });
    return true;
  }

  // 24. Can't attack / Allow attacking active units / Pair from trash
  if (/can'?t attack|can'?t choose the enemy player as its attack target/i.test(s)) {
    state.steps.push({
      action: 'CANT_ATTACK',
      duration: parseDuration(s),
      target: state.chosenTarget ?? { owner: 'SELF', self: true, cardType: 'UNIT' },
    });
    return true;
  }
  if (/may choose (?:an? )?(?:damaged )?(?:active|rested) enemy unit/i.test(s)) {
    state.steps.push({
      action: 'ALLOW_ATTACK_ACTIVE',
      target: state.chosenTarget?.owner === 'SELF' ? state.chosenTarget : parseTargetSelector(s),
    });
    return true;
  }
  if (/pair this card from your trash/i.test(s)) {
    const sel = parseTargetSelector(s);
    state.steps.push({
      action: 'PAIR_SELF_FROM_TRASH',
      target: { ...sel, owner: 'SELF', cardType: 'UNIT', zone: 'BATTLE_AREA' },
    });
    return true;
  }
  return false;
}

export function parseFallbackSentence(ctx: SentenceContext): boolean {
  const { s, state } = ctx;
  // 25. Count units
  const countUnitsM = s.match(/^count up the number of (.+?)(?:, plus this unit)?\.?$/i);
  if (countUnitsM) {
    state.steps.push({
      action: 'COUNT_UNITS',
      target: parseTargetSelector(countUnitsM[1]),
      ...( /plus this unit/i.test(s) ? { plusSelf: true } : {} ),
    });
    return true;
  }

  // 26. Trash / mill
  if (/place (?:the top |the remaining )?(?:\d+ )?cards?.*into your trash/i.test(s)) {
    const m = s.match(/(\d+)/);
    state.steps.push({ action: 'MILL', count: m ? parseInt(m[1], 10) : 1 });
    return true;
  }

  // 27. Compound "Choose X and <action>" or "A and B"
  if (/\bChoose\b/i.test(s) && /\.\s*/.test(s) === false) {
    const parts = s.split(/\s+and\s+/i);
    if (parts.length > 1) {
      for (const p of parts) parseSentenceSteps(p, state);
      return true;
    }
  }

  // 28. Trailing comma lead-in (e.g. "If this effect ...") fallback strip ONLY for already-typed events
  const mIfThen = s.match(/^(?:If this effect [^,]+|On the turn [^,]+),\s*(.+)$/i);
  if (mIfThen) {
    parseSentenceSteps(mIfThen[1], state);
    return true;
  }
  return false;
}
