import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/gundam-sync';

export async function GET() {
  try {
    const catalog = await getCatalog();
    return NextResponse.json(catalog);
  } catch (err) {
    console.error('Failed to load catalog:', err);
    return NextResponse.json({ error: 'Failed to load card catalog' }, { status: 500 });
  }
}
