import { NextRequest, NextResponse } from 'next/server';
import { getCatalog } from '@/lib/gundam-sync';

const ALLOWED_EXBURST_HOSTS = new Set(['exburst.dev', 'www.exburst.dev']);

function validateExburstUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:') return null;
    if (!ALLOWED_EXBURST_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (!url.pathname.toLowerCase().startsWith('/gundam')) return null;
    return url;
  } catch {
    return null;
  }
}

function extractExburstDeckFromHtml(
  html: string,
  validCardNos: Set<string>
): { deckName: string; lines: string[]; unmatched: string[] } {
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const rawTitle = titleMatch ? titleMatch[1].replace(/\s*[-·|]\s*Gundam Card Game.*$/i, '').trim() : '';
  const deckName = rawTitle || 'ExBurst Imported Deck';

  const counts = new Map<string, number>();
  const unmatched: string[] = [];

  // 1. Parse Nuxt SSR __NUXT_DATA__ payload if present (contains originalIdCounts map)
  const nuxtMatch = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nuxtMatch) {
    try {
      const arr = JSON.parse(nuxtMatch[1]) as unknown[];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const obj = item as Record<string, unknown>;
            if (obj.originalIdCounts !== undefined) {
              const refIdx = obj.originalIdCounts;
              const target =
                typeof refIdx === 'number' && refIdx >= 0 && refIdx < arr.length
                  ? arr[refIdx]
                  : refIdx;
              if (target && typeof target === 'object' && !Array.isArray(target)) {
                for (const [rawId, rawQtyRef] of Object.entries(target as Record<string, unknown>)) {
                  const qtyVal =
                    typeof rawQtyRef === 'number' &&
                    rawQtyRef >= 0 &&
                    rawQtyRef < arr.length &&
                    typeof arr[rawQtyRef] === 'number' &&
                    !Number.isNaN(arr[rawQtyRef] as number) &&
                    (arr[rawQtyRef] as number) <= 50
                      ? (arr[rawQtyRef] as number)
                      : Number(rawQtyRef);

                  const cardNo = rawId.toUpperCase().replace(/_.*$/, '');
                  if (Number.isInteger(qtyVal) && qtyVal > 0) {
                    if (validCardNos.has(cardNo)) {
                      counts.set(cardNo, (counts.get(cardNo) ?? 0) + qtyVal);
                    } else {
                      unmatched.push(`${qtyVal} ${cardNo}`);
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // Fall through to HTML pattern extraction
    }
  }

  // 2. Fallback: extract strict `<qty> <cardNo>` or ExBurst image/card patterns from rendered HTML
  if (counts.size === 0) {
    const rx = /\b([1-9]|10)\s*[x×]?\s*(?:F)?([A-Z]{1,4}\d*-\d{3})\b/g;
    for (const m of html.matchAll(rx)) {
      const qty = parseInt(m[1], 10);
      const cardNo = m[2].toUpperCase();
      if (validCardNos.has(cardNo)) {
        counts.set(cardNo, (counts.get(cardNo) ?? 0) + qty);
      }
    }
  }

  const lines = [...counts.entries()].map(([cardNo, qty]) => `${qty} ${cardNo}`);
  return { deckName, lines, unmatched };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body?.url === 'string' ? body.url : '';
    const parsedUrl = validateExburstUrl(rawUrl);

    if (!parsedUrl) {
      return NextResponse.json(
        {
          error:
            'Invalid ExBurst URL. Expected an https://exburst.dev/gundam/... deck link (e.g. https://exburst.dev/gundam/deck/451794).',
        },
        { status: 400 }
      );
    }

    const upstream = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GundamCardAtlas/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: `ExBurst returned HTTP ${upstream.status}. You can copy the deck text from ExBurst and paste "<qty> <cardNo>" lines directly into Strict Text import.`,
        },
        { status: 502 }
      );
    }

    const html = await upstream.text();
    const catalog = await getCatalog();
    const validCardNos = new Set(catalog.cards.map((c) => c.cardNo.toUpperCase()));
    const extracted = extractExburstDeckFromHtml(html, validCardNos);

    if (extracted.lines.length === 0) {
      return NextResponse.json(
        {
          error:
            'Could not detect deck cards on that ExBurst page (private or client-only builder draft). Export the text list on ExBurst and paste "<qty> <cardNo>" lines into Strict Text import.',
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      deckName: extracted.deckName,
      strictText: extracted.lines.join('\n'),
      cardCount: extracted.lines.length,
      unmatched: extracted.unmatched,
    });
  } catch (err) {
    console.error('ExBurst import error:', err);
    return NextResponse.json(
      {
        error:
          'Unable to fetch ExBurst deck right now. Paste "<qty> <cardNo>" lines into Strict Text import instead.',
      },
      { status: 502 }
    );
  }
}
