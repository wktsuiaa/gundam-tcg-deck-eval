import type { CardColor, DeckEntry, GundamCardPrint, SavedDeck } from '@/types/gundam';
import { MAIN_DECK_TYPES } from './shared';
import { DEFAULT_BLUEPRINT } from './strategy-meta';

/** Strict `<number> <card number>` export only (Q4) */
export function exportDeckToText(
  deck: SavedDeck,
  _byPrintId?: Map<string, GundamCardPrint>,
  _byCardNo?: Map<string, GundamCardPrint>
): string {
  const lines: string[] = [];
  for (const entry of deck.mainDeck) {
    if (entry.qty > 0) lines.push(`${entry.qty} ${entry.cardNo}`);
  }
  for (const entry of deck.resourceDeck) {
    if (entry.qty > 0) lines.push(`${entry.qty} ${entry.cardNo}`);
  }
  return lines.join('\n');
}

/** Strict `<number> <card number>` import parser only (Q4) */
export function parseDeckFromText(
  rawText: string,
  byPrintId: Map<string, GundamCardPrint>,
  byCardNo: Map<string, GundamCardPrint>
): { mainDeck: DeckEntry[]; resourceDeck: DeckEntry[]; unmatched: string[] } {
  const mainMap = new Map<string, DeckEntry>();
  const resMap = new Map<string, DeckEntry>();
  const unmatched: string[] = [];

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Accept strictly `<integer> <cardNo>` with no comments, `4x`, or card names
    const match = line.match(/^(\d+)\s+([A-Za-z0-9_-]+)$/);
    if (!match) {
      unmatched.push(line);
      continue;
    }

    const qty = parseInt(match[1], 10);
    const idToken = match[2];
    if (!Number.isInteger(qty) || qty <= 0) {
      unmatched.push(line);
      continue;
    }

    const card = byPrintId.get(idToken) ?? byCardNo.get(idToken.toUpperCase());
    if (!card) {
      unmatched.push(line);
      continue;
    }

    const targetMap = card.type === 'RESOURCE' ? resMap : mainMap;
    const prev = targetMap.get(card.cardNo);
    targetMap.set(card.cardNo, {
      cardNo: card.cardNo,
      printId: prev?.printId ?? card.printId,
      qty: (prev?.qty ?? 0) + qty,
    });
  }

  return {
    mainDeck: [...mainMap.values()],
    resourceDeck: [...resMap.values()],
    unmatched,
  };
}

export function encodeDeckShareParam(deck: SavedDeck): string {
  const compact = {
    n: deck.name,
    m: deck.mainDeck.map((e) => [e.cardNo, e.qty]),
    r: deck.resourceDeck.map((e) => [e.cardNo, e.qty]),
  };
  const json = JSON.stringify(compact);
  if (typeof window !== 'undefined') {
    return btoa(unescape(encodeURIComponent(json)));
  }
  return Buffer.from(json, 'utf-8').toString('base64');
}

export function decodeDeckShareParam(
  encoded: string,
  byCardNo: Map<string, GundamCardPrint>
): SavedDeck | null {
  try {
    const json =
      typeof window !== 'undefined'
        ? decodeURIComponent(escape(atob(encoded)))
        : Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.m)) return null;
    const mainDeck: DeckEntry[] = [];
    for (const [cardNo, qty] of parsed.m) {
      const c = byCardNo.get(cardNo);
      if (c && Number(qty) > 0) {
        mainDeck.push({ cardNo: c.cardNo, printId: c.printId, qty: Number(qty) });
      }
    }
    const resourceDeck: DeckEntry[] = [];
    if (Array.isArray(parsed.r)) {
      for (const [cardNo, qty] of parsed.r) {
        const c = byCardNo.get(cardNo);
        if (c && Number(qty) > 0) {
          resourceDeck.push({ cardNo: c.cardNo, printId: c.printId, qty: Number(qty) });
        }
      }
    }
    return {
      id: `shared-${Date.now()}`,
      name: String(parsed.n || 'Shared Gundam Deck'),
      updatedAt: new Date().toISOString(),
      mainDeck,
      resourceDeck,
    };
  } catch {
    return null;
  }
}

export function createBlankCustomDeck(index = 1): SavedDeck {
  return {
    id: `custom-${Date.now()}-${index}`,
    name: index === 1 ? 'Custom Deck' : `Custom Deck ${index}`,
    updatedAt: new Date().toISOString(),
    mainDeck: [],
    resourceDeck: [],
    strategyBlueprint: DEFAULT_BLUEPRINT,
  };
}

export interface StarterPresetMeta {
  code: string;
  name: string;
  colors: CardColor[];
  subtitle: string;
}

export const STARTER_PRESETS: StarterPresetMeta[] = [
  { code: 'ST01', name: 'ST01 Heroic Beginnings', colors: ['Blue', 'White'], subtitle: 'White Base Repair & Link Control' },
  { code: 'ST02', name: 'ST02 Wings of Advance', colors: ['Green', 'Blue'], subtitle: 'Operation Meteor Ramp & Tempo' },
  { code: 'ST03', name: "ST03 Zeon's Rush", colors: ['Red', 'Green'], subtitle: 'Zeon Aggro & Early Breach' },
  { code: 'ST04', name: 'ST04 SEED Strike', colors: ['White', 'Red'], subtitle: 'ZAFT / Archangel Link Midrange' },
  { code: 'ST05', name: 'ST05 Iron Bloom', colors: ['Purple', 'White'], subtitle: 'Tekkadan Disruption & Recursion' },
  { code: 'ST06', name: 'ST06 Clan Unity', colors: ['Red', 'Blue'], subtitle: 'Clan Link Tempo' },
];

export function buildStarterDeckFromCatalog(
  presetCode: string,
  allCards: GundamCardPrint[]
): SavedDeck {
  const preset = STARTER_PRESETS.find((p) => p.code === presetCode) ?? STARTER_PRESETS[0];
  const prefix = `${preset.code}-`;
  const stCards = allCards.filter(
    (c) => c.cardNo.startsWith(prefix) && !c.isParallel && MAIN_DECK_TYPES.has(c.type)
  );
  const resCard = allCards.find((c) => c.type === 'RESOURCE');

  const mainDeck: DeckEntry[] = [];
  let total = 0;

  for (const c of stCards) {
    if (total >= 50) break;
    const qty = c.rarity === 'LR' ? 2 : c.rarity === 'R' ? 3 : 4;
    const add = Math.min(qty, 50 - total);
    if (add > 0) {
      mainDeck.push({ cardNo: c.cardNo, printId: c.printId, qty: add });
      total += add;
    }
  }
  let idx = 0;
  while (total < 50 && mainDeck.length > 0 && idx < mainDeck.length * 4) {
    const entry = mainDeck[idx % mainDeck.length];
    if (entry.qty < 4) {
      entry.qty += 1;
      total += 1;
    }
    idx += 1;
  }

  return {
    id: `starter-${preset.code}-${Date.now()}`,
    name: preset.name,
    updatedAt: new Date().toISOString(),
    mainDeck,
    resourceDeck: resCard ? [{ cardNo: resCard.cardNo, printId: resCard.printId, qty: 10 }] : [],
  };
}
