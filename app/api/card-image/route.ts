import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_PREFIXES = ['jp/images/cards/', 'asia-en/images/', 'images/'];

export async function GET(req: NextRequest) {
  const pathParam = req.nextUrl.searchParams.get('path') || '';
  const normalized = pathParam.replace(/^\/+/, '');

  if (
    !normalized ||
    normalized.includes('..') ||
    !ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return NextResponse.json({ error: 'Invalid image path' }, { status: 400 });
  }

  const targetUrl = `https://www.gundam-gcg.com/${normalized}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GundamCardAtlas/1.0)',
        Referer: 'https://www.gundam-gcg.com/asia-en/cards/',
      },
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: 'Image not found' }, { status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') || 'image/webp';
    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to proxy card image' }, { status: 502 });
  }
}
