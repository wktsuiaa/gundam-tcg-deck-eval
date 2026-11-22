import { NextRequest, NextResponse } from 'next/server';
import { syncOfficialCatalog } from '@/lib/gundam-sync';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const force = Boolean(body?.force);
    const result = await syncOfficialCatalog(force);
    return NextResponse.json({
      addedCount: result.addedCount,
      updatedCount: result.updatedCount,
      totalPrints: result.catalog.totalPrints,
      syncedAt: result.catalog.syncedAt,
      catalog: result.catalog,
    });
  } catch (err) {
    console.error('Catalog sync failed:', err);
    return NextResponse.json(
      { error: 'Failed to sync with official gundam-gcg.com catalog' },
      { status: 500 }
    );
  }
}
