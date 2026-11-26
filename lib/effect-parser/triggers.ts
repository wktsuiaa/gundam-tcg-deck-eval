import { combineConditions, parseCondition } from './conditions.ts';
import { parseTargetSelector } from './selectors.ts';
import { type EffectCondition, type EffectTiming, type TargetSelector, type TriggerEvent } from './types.ts';

export function parseLeadingWhenTrigger(rawClause: string): {
  triggerEvent: TriggerEvent;
  extraCondition?: EffectCondition;
  restBody: string;
} | null {
  // Match leading "When ..." (outside quotes/subclauses) up to the comma before the effect body
  const m = rawClause.match(/^(when\s+.+?),\s*(.+)$/i);
  if (!m) return null;
  let triggerText = m[1].trim();
  let restBody = m[2].trim();

  // Pull trailing guard condition if split like "When X, if Y, action"
  let extraCondition: EffectCondition | undefined;
  const nestedIf = restBody.match(/^((?:if|while)\s+[^,]+),\s*(.+)$/i);
  if (nestedIf && !/^if you do/i.test(nestedIf[1]) && !/^if (?:it|they|you placed|you draw|you discard|you increase)/i.test(nestedIf[1])) {
    extraCondition = parseCondition(nestedIf[1]);
    restBody = nestedIf[2].trim();
  }

  // Pull trailing "while ..." inside triggerText e.g. "When an enemy Link Unit is destroyed with damage while this Unit is attacking"
  const whileM = triggerText.match(/^(.+?)\s+(while\s+.+)$/i);
  let whileAttacking = false;
  if (whileM) {
    if (/while this unit is attacking/i.test(whileM[2])) {
      whileAttacking = true;
      triggerText = whileM[1].trim();
    } else {
      extraCondition = combineConditions(extraCondition, parseCondition(whileM[2]));
      triggerText = whileM[1].trim();
    }
  }

  let kind: EffectTiming = 'WHEN_ATTACKED';
  let actor: TriggerEvent['actor'] = 'SELF';
  let actorFilter: TargetSelector | undefined;
  let targetKind: TriggerEvent['targetKind'];
  let targetFilter: TargetSelector | undefined;
  let damageType: TriggerEvent['damageType'];

  if (/when this unit is attacked/i.test(triggerText)) {
    kind = 'WHEN_ATTACKED';
    actor = 'SELF';
  } else if (/when another unit attacks/i.test(triggerText)) {
    kind = 'ATTACK';
    actor = 'ANY';
    actorFilter = parseTargetSelector(triggerText.replace(/^when\s+/i, ''));
  } else if (/destroys? .* with (?:battle )?damage|is destroyed with (?:effect |battle )?damage/i.test(triggerText)) {
    kind = 'WHEN_DESTROY_BY_BATTLE';
    damageType = /battle damage/i.test(triggerText) ? 'BATTLE' : /effect damage/i.test(triggerText) ? 'EFFECT' : 'ANY';
    if (/^when an enemy/i.test(triggerText)) {
      actor = 'ENEMY';
      targetKind = 'UNIT';
      targetFilter = parseTargetSelector(triggerText);
    } else if (/one of your|friendly/i.test(triggerText)) {
      actor = 'FRIENDLY';
      actorFilter = parseTargetSelector(triggerText.split(/destroys?/i)[0]);
    } else {
      actor = 'SELF';
    }
    if (/enemy card/i.test(triggerText)) targetKind = 'ANY_ENEMY_CARD';
    else if (/shield area card/i.test(triggerText)) targetKind = 'SHIELD';
    else if (/enemy unit/i.test(triggerText)) {
      targetKind = 'UNIT';
      const afterDest = triggerText.split(/destroys?/i)[1];
      if (afterDest) targetFilter = parseTargetSelector(afterDest);
    }
  } else if (/deals (?:battle )?damage/i.test(triggerText)) {
    kind = 'WHEN_DEAL_DAMAGE';
    damageType = /battle damage/i.test(triggerText) ? 'BATTLE' : 'ANY';
    actor = /your .* cards/i.test(triggerText) ? 'FRIENDLY' : 'SELF';
    if (/your \([^)]+\) cards/i.test(triggerText)) actorFilter = parseTargetSelector(triggerText);
    const toPart = triggerText.split(/\bto\b/i)[1];
    if (toPart) targetFilter = parseTargetSelector(toPart);
    targetKind = 'UNIT';
  } else if (/(?:receives?|would receive) .* damage/i.test(triggerText)) {
    kind = 'WHEN_RECEIVE_DAMAGE';
    damageType = /battle damage/i.test(triggerText) ? 'BATTLE' : /effect damage/i.test(triggerText) ? 'EFFECT' : 'ANY';
    actor = /friendly|one of your/i.test(triggerText) ? 'FRIENDLY' : 'SELF';
    if (/shield/i.test(triggerText)) targetKind = 'SHIELD';
    else if (/this base/i.test(triggerText)) targetKind = 'BASE';
    else targetKind = 'UNIT';
  } else if (/recovers HP/i.test(triggerText)) {
    kind = 'WHEN_RECOVER_HP';
    actor = 'SELF';
  } else if (/is deployed/i.test(triggerText)) {
    kind = 'WHEN_UNIT_DEPLOYED';
    actor = /this unit or/i.test(triggerText) || /one of your|friendly/i.test(triggerText) ? 'FRIENDLY' : 'SELF';
    actorFilter = parseTargetSelector(triggerText);
  } else if (/pair a pilot/i.test(triggerText)) {
    kind = 'WHEN_UNIT_PAIRED';
    actor = 'FRIENDLY';
  } else if (/links\b/i.test(triggerText)) {
    kind = 'WHEN_UNIT_LINKED';
    actor = 'FRIENDLY';
    actorFilter = parseTargetSelector(triggerText);
  } else if (/is destroyed by an effect/i.test(triggerText)) {
    kind = 'WHEN_UNIT_DESTROYED';
    actor = 'FRIENDLY';
  } else if (/is rested by|would rest/i.test(triggerText)) {
    kind = 'WHEN_RESTED';
    actor = /this unit/i.test(triggerText) ? 'SELF' : 'FRIENDLY';
  } else if (/is blocked|activates\s*<Blocker>/i.test(triggerText)) {
    kind = 'WHEN_BLOCKED';
    actor = 'SELF';
  } else if (/exile[sd]? .* ex resource/i.test(triggerText)) {
    kind = 'WHEN_EXILE_EX_RESOURCE';
    actor = 'FRIENDLY';
  } else if (/place an EX Resource/i.test(triggerText)) {
    kind = 'WHEN_PLACE_EX_RESOURCE';
    actor = 'SELF';
  } else if (/play and activate .* using an EX Resource/i.test(triggerText)) {
    kind = 'WHEN_PLAY_CARD_WITH_EX_RESOURCE';
    actor = 'SELF';
    targetFilter = parseTargetSelector(triggerText);
  } else if (/activate a .* command/i.test(triggerText)) {
    kind = 'WHEN_ACTIVATE_COMMAND';
    actor = 'SELF';
    targetFilter = parseTargetSelector(triggerText);
  } else if (/pay [①②③④⑤⑥⑦⑧⑨⑩] or more/i.test(triggerText)) {
    kind = 'WHEN_PAY_EFFECT_COST';
    actor = 'FRIENDLY';
  } else if (/draw with an effect/i.test(triggerText)) {
    kind = 'WHEN_DRAW';
    actor = 'SELF';
  } else if (/AP is reduced/i.test(triggerText)) {
    kind = 'WHEN_AP_REDUCED';
    actor = 'SELF';
  } else if (/playing this card/i.test(triggerText)) {
    kind = 'WHEN_PLAYING';
    actor = 'SELF';
    if (/pairing it with/i.test(triggerText)) {
      const pairingPart = triggerText.split(/pairing it with/i)[1];
      if (pairingPart) {
        const tgt = parseTargetSelector(pairingPart);
        const linkM = pairingPart.match(/\[([^\]]+)\]\s*link condition/i);
        extraCondition = {
          kind: 'SELF_STATE',
          pairedWithUnit: {
            ...(tgt.traits ? { traits: tgt.traits } : tgt.trait ? { traits: [tgt.trait] } : {}),
            ...(tgt.nameContains ? { nameContains: tgt.nameContains } : {}),
            ...(linkM ? { linkNames: [linkM[1]] } : {}),
            ...(tgt.lvMin !== undefined ? { lvMin: tgt.lvMin } : {}),
          },
        };
      }
    }
  }

  return {
    triggerEvent: {
      kind,
      actor,
      ...(actorFilter ? { actorFilter } : {}),
      ...(targetKind ? { targetKind } : {}),
      ...(targetFilter ? { targetFilter } : {}),
      ...(damageType ? { damageType } : {}),
      ...(whileAttacking ? { whileAttacking } : {}),
      raw: triggerText,
    },
    ...(extraCondition ? { extraCondition } : {}),
    restBody,
  };
}
