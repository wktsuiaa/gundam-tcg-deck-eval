import { parseScaleMetric, parseTargetSelector } from './selectors.ts';
import { type SentenceContext } from './sentence-steps.ts';
import { CIRCLED_NUMS, extractAllTraits, parseKeywordToken } from './text-utils.ts';
import { type EffectStep } from './types.ts';

export function parseBasicSentence(ctx: SentenceContext): boolean {
  const { s, state, optional } = ctx;
  // 5. Pilot mode token "[Lowe Guele]" leftover from 【Pilot】[Lowe Guele]
  if (/^\[([^\]]+)\]$/.test(s)) {
    const inner = s.slice(1, -1).trim();
    const kw = parseKeywordToken(inner);
    if (kw) {
      state.steps.push({
        action: 'GRANT_KEYWORD',
        keyword: kw,
        target: { owner: 'SELF', self: true, cardType: 'UNIT' },
      });
    } else {
      state.steps.push({ action: 'GRANT_PILOT_MODE', pilotName: inner });
    }
    return true;
  }

  // 6. Name alias: "This card's name is also treated as [Char Aznable]."
  const aliasM = s.match(/^This card'?s name is also treated as \[([^\]]+)\]\.?$/i);
  if (aliasM) {
    state.steps.push({ action: 'NAME_ALIAS', alias: aliasM[1].trim() });
    return true;
  }

  // 7. Standard self/activation steps
  if (/^add this card to your hand\.?$/i.test(s)) {
    state.steps.push({ action: 'ADD_SELF_TO_HAND' });
    return true;
  }
  if (/^deploy this card\.?$/i.test(s)) {
    state.steps.push({ action: 'DEPLOY_SELF' });
    return true;
  }
  if (/^activate (?:this card'?s |its )?【(?:Main|Action)】/i.test(s) || /^activate 【(?:Main|Action)】 on /i.test(s)) {
    state.steps.push({ action: 'ACTIVATE_MAIN_EFFECT', ...(state.chosenTarget ? { target: state.chosenTarget } : {}) });
    return true;
  }

  // 8. "Pay ①/②"
  const payM = s.match(/^pay ([①②③④⑤⑥⑦⑧⑨⑩])\.?$/i);
  if (payM) {
    state.steps.push({ action: 'PAY_RESOURCE', amount: CIRCLED_NUMS[payM[1]] ?? 1, ...(optional ? { optional: true } : {}) });
    return true;
  }

  // 9. "Choose <target> and add it to your hand." or "Choose <target>." (without inline verb)
  const chooseAndAddM = s.match(/^choose (.+?) and add (?:it|them) to your hand\.?$/i);
  if (chooseAndAddM) {
    const sel = parseTargetSelector(chooseAndAddM[1]);
    state.steps.push({ action: sel.zone === 'TRASH' ? 'ADD_FROM_TRASH_TO_HAND' : 'LOOK_TOP', ...(sel.zone === 'TRASH' ? { target: sel } : { count: 1, revealSearch: true, target: sel }) } as EffectStep);
    return true;
  }

  const chooseOnly = s.match(/^(?:all enemy players each |all players each |you and that player each |that player )?chooses? (.+?)\.?$/i);
  if (chooseOnly && !/\b(destroy|deal|rest|set|return|deploy|add|recover|gains?|gets?|as their attack target)\b/i.test(chooseOnly[1])) {
    const sel = parseTargetSelector(chooseOnly[1]);
    if (/^all enemy players/i.test(s)) sel.owner = 'ENEMY';
    state.chosenTarget = sel;
    return true;
  }
  return false;
}

export function parseCardFlowSentence(ctx: SentenceContext): boolean {
  const { s, state, optional } = ctx;
  // 10. Draw / Discard
  const drawScaleM = s.match(/^draw a number of cards equal to (.+?)\.?$/i);
  if (drawScaleM) {
    state.steps.push({
      action: 'DRAW',
      count: 1,
      scaleBy: parseScaleMetric(drawScaleM[1]),
      ...(optional ? { optional: true } : {}),
    });
    return true;
  }
  const drawM = s.match(/^(?:(you and .*?|all players|they) )?draw (\d+)(?: cards?)?\.?$/i);
  if (drawM) {
    const who = drawM[1]?.toLowerCase() ?? '';
    state.steps.push({
      action: 'DRAW',
      count: parseInt(drawM[2], 10),
      bothPlayers: /you and|all players/.test(who),
      ...(who.includes('all players') ? { targetOwner: 'ALL_PLAYERS' as const } : who === 'they' ? { targetOwner: 'ENEMY' as const } : {}),
      ...(optional ? { optional: true } : {}),
    });
    return true;
  }

  const discScaleM = s.match(/^discard the same number of cards you drew with this effect\.?$/i);
  if (discScaleM) {
    state.steps.push({ action: 'DISCARD', count: 1, scaleBy: { metric: 'DRAWN_COUNT' } });
    return true;
  }
  const discM = s.match(/^(?:(they|that enemy player|that player|all players)\s+)?(?:may\s+)?discards?\s+(?:(\d+)|(.+?))(?:\s+cards?)?\.?$/i);
  if (discM) {
    const who = discM[1]?.toLowerCase() ?? '';
    const n = discM[2] ? parseInt(discM[2], 10) : 1;
    const isMay = /\bmay\b/i.test(s);
    state.steps.push({
      action: 'DISCARD',
      count: n,
      ...(who ? { targetOwner: who === 'all players' ? 'ALL_PLAYERS' : 'ENEMY' } : {}),
      ...(discM[3] ? { target: parseTargetSelector(discM[3]) } : {}),
      ...(optional || isMay ? { optional: true } : {}),
    });
    return true;
  }

  // 11. Look at top N / Reveal from hand / Reveal top N
  const lookM = s.match(/^(?:all players each )?look at the top (\d+|) ?cards? of (?:your|their) deck/i);
  if (lookM) {
    const count = lookM[1] ? parseInt(lookM[1], 10) : 1;
    const traits = extractAllTraits(s);
    const revTargetM = s.match(/reveal (.+?) among them/i);
    state.steps.push({
      action: 'LOOK_TOP',
      count,
      revealSearch: /reveal|add|deploy/i.test(s),
      trashRest: /into your trash/i.test(s),
      ...(traits[0] ? { trait: traits[0] } : {}),
      ...(revTargetM ? { target: parseTargetSelector(revTargetM[1]) } : {}),
      ...( /bottom of your deck/i.test(s) ? { remainderPosition: 'BOTTOM' as const } : /top or bottom/i.test(s) ? { remainderPosition: 'TOP' as const } : {}),
    });
    return true;
  }
  const revTopM = s.match(/^reveal the top (\d+) cards? of your deck/i);
  if (revTopM) {
    state.steps.push({ action: 'REVEAL_TOP', count: parseInt(revTopM[1], 10) });
    return true;
  }
  const revHandM = s.match(/^reveal (.+?from your hand)\.?$/i);
  if (revHandM) {
    state.steps.push({ action: 'REVEAL_FROM_HAND', target: parseTargetSelector(revHandM[1]) });
    return true;
  }

  // 12. Shields
  if (/add (\d+) of your shields to your hand/i.test(s)) {
    const m = s.match(/add (\d+)/i);
    state.steps.push({ action: 'ADD_SHIELD_TO_HAND', count: m ? parseInt(m[1], 10) : 1 });
    return true;
  }

  // 13. Deploy from trash / hand / deck / among them / token / EX Base
  if (/^pay its cost to deploy it\.?$/i.test(s) && state.chosenTarget) {
    state.steps.push({ action: 'DEPLOY_FROM_TRASH', free: false, target: state.chosenTarget });
    return true;
  }
  if (/^deploy (it|them)(?: rested)?\.?$/i.test(s) && state.chosenTarget) {
    state.steps.push({
      action: state.chosenTarget.zone === 'TRASH' ? 'DEPLOY_FROM_TRASH' : 'DEPLOY_TOKEN',
      free: true,
      rested: /rested/i.test(s),
      target: state.chosenTarget,
    } as EffectStep);
    return true;
  }
  const deployHandM = s.match(/^deploy (.+?from your hand)\.?$/i);
  if (deployHandM) {
    state.steps.push({ action: 'DEPLOY_FROM_HAND', free: true, target: parseTargetSelector(deployHandM[1]) });
    return true;
  }
  const deployAmongM = s.match(/^deploy (.+?among them)\.?$/i);
  if (deployAmongM) {
    state.steps.push({ action: 'DEPLOY_FROM_TOP_DECK', target: parseTargetSelector(deployAmongM[1]) });
    return true;
  }
  if (/^deploy 1 EX Base\.?$/i.test(s)) {
    state.steps.push({ action: 'DEPLOY_TOKEN', count: 1, ap: 0, hp: 3, name: 'EX Base', baseToken: true, exBase: true });
    return true;
  }
  const tokM = s.match(/(?:the destroyed unit'?s owner\s+)?deploys? (\d+) .*?\b(unit|base) tokens?\b/i);
  if (tokM) {
    const apM2 = s.match(/AP(\d+)/i);
    const hpM2 = s.match(/HP(\d+)/i);
    const nameM = s.match(/\[([^\]]+)\]/);
    const traits = extractAllTraits(s);
    state.steps.push({
      action: 'DEPLOY_TOKEN',
      count: parseInt(tokM[1], 10),
      ap: apM2 ? parseInt(apM2[1], 10) : tokM[2].toLowerCase() === 'base' ? 0 : 2,
      hp: hpM2 ? parseInt(hpM2[1], 10) : tokM[2].toLowerCase() === 'base' ? 5 : 2,
      ...(nameM ? { name: nameM[1] } : {}),
      ...(traits.length > 0 ? { traits } : {}),
      ...(tokM[2].toLowerCase() === 'base' ? { baseToken: true } : {}),
      ...(/destroyed unit'?s owner/i.test(s) ? { owner: 'DESTROYED_OWNER' as const } : {}),
    });
    return true;
  }

  // 14. Pair from hand / trash
  const pairHandM = s.match(/^pair (.+?) with (.+?)\.?$/i);
  if (pairHandM) {
    const pilotSel = /^(it|that card)$/i.test(pairHandM[1].trim())
      ? { owner: 'SELF' as const, cardType: 'COMMAND' as const, zone: 'TRASH' as const }
      : parseTargetSelector(pairHandM[1]);
    const unitSel = parseTargetSelector(pairHandM[2]);
    if (/from your trash/i.test(s)) {
      state.steps.push({ action: 'PAIR_SELF_FROM_TRASH', target: { ...unitSel, owner: 'SELF', cardType: 'UNIT', zone: 'BATTLE_AREA' } });
    } else {
      state.steps.push({ action: 'PAIR_FROM_HAND', pilotFilter: pilotSel, target: unitSel });
    }
    return true;
  }

  // 15. Add to hand from trash / deck
  const addTrashM = s.match(/^add (.+?from your trash) to your hand\.?$/i);
  if (addTrashM) {
    state.steps.push({ action: 'ADD_FROM_TRASH_TO_HAND', target: parseTargetSelector(addTrashM[1]) });
    return true;
  }
  const addFromDeckM = s.match(/^add (.+?placed from your deck with this effect) to your hand\.?$/i);
  if (addFromDeckM) {
    state.steps.push({ action: 'LOOK_TOP', count: 1, revealSearch: true, target: parseTargetSelector(addFromDeckM[1]) });
    return true;
  }
  if (/^add (it|them) (?:from your trash )?to your hand\.?$/i.test(s)) {
    if (state.chosenTarget?.zone === 'TRASH' || /from your trash/i.test(s)) {
      state.steps.push({ action: 'ADD_FROM_TRASH_TO_HAND', target: state.chosenTarget ?? { owner: 'SELF', cardType: 'CARD', zone: 'TRASH', count: 1 } });
    } else {
      state.steps.push({ action: 'LOOK_TOP', count: 1, revealSearch: true });
    }
    return true;
  }
  return false;
}
