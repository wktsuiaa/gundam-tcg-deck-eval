'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, CheckCircle2, X } from 'lucide-react';
import type {
  CatalogPayload,
  CollectionMap,
  GundamCardGroup,
  GundamCardPrint,
  SavedDeck,
} from '@/types/gundam';
import { groupPrintsByCardNo } from '@/lib/gundam-keywords';
import {
  buildStarterDeckFromCatalog,
  decodeDeckShareParam,
  resolveCardMap,
} from '@/lib/deck-engine';
import { CatalogWorkspace } from '@/components/CatalogWorkspace';
import { DeckWorkspace } from '@/components/DeckWorkspace';
import { CollectionWorkspace } from '@/components/CollectionWorkspace';
import { CardDetailDrawer } from '@/components/CardDetailDrawer';

interface GundamAtlasAppProps {
  initialCatalog: CatalogPayload;
}

const LS_COLLECTION_KEY = 'gundam_atlas_collection_v1';
const LS_DECKS_KEY = 'gundam_atlas_decks_v1';
const LS_ACTIVE_DECK_KEY = 'gundam_atlas_active_deck_v1';

export function GundamAtlasApp({ initialCatalog }: GundamAtlasAppProps) {
  const [catalog, setCatalog] = useState<CatalogPayload>(initialCatalog);
  const [activeTab, setActiveTab] = useState<'catalog' | 'deck' | 'collection'>('catalog');
  const [collection, setCollection] = useState<CollectionMap>({});
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);

  // Card Inspector state
  const [inspected, setInspected] = useState<{ cardNo: string; printId?: string } | null>(null);

  // Sync status
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const { byCardNo } = useMemo(() => resolveCardMap(catalog.cards), [catalog.cards]);

  const cardGroupsByNo = useMemo(() => {
    const groups = groupPrintsByCardNo(catalog.cards);
    const map = new Map<string, GundamCardGroup>();
    for (const g of groups) map.set(g.cardNo, g);
    return map;
  }, [catalog.cards]);

  // Hydrate localStorage + check ?deck= share parameter
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const rawCol = localStorage.getItem(LS_COLLECTION_KEY);
        if (rawCol) setCollection(JSON.parse(rawCol));

        const rawDecks = localStorage.getItem(LS_DECKS_KEY);
        let loadedDecks: SavedDeck[] = rawDecks ? JSON.parse(rawDecks) : [];

        if (loadedDecks.length === 0 && catalog.cards.length > 0) {
          loadedDecks = [buildStarterDeckFromCatalog('ST01', catalog.cards)];
        }

        const params = new URLSearchParams(window.location.search);
        const sharedParam = params.get('deck');
        let targetDeckId = localStorage.getItem(LS_ACTIVE_DECK_KEY) || loadedDecks[0]?.id || '';

        if (sharedParam && catalog.cards.length > 0) {
          const sharedDeck = decodeDeckShareParam(sharedParam, byCardNo);
          if (sharedDeck) {
            loadedDecks = [sharedDeck, ...loadedDecks];
            targetDeckId = sharedDeck.id;
            setActiveTab('deck');
          }
        }

        setDecks(loadedDecks);
        setActiveDeckId(targetDeckId);
      } catch {
        // ignore storage errors
      } finally {
        setHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [catalog.cards, byCardNo]);

  // Persist changes
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_COLLECTION_KEY, JSON.stringify(collection));
    } catch {
      // ignore
    }
  }, [collection, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_DECKS_KEY, JSON.stringify(decks));
      if (activeDeckId) localStorage.setItem(LS_ACTIVE_DECK_KEY, activeDeckId);
    } catch {
      // ignore
    }
  }, [decks, activeDeckId, hydrated]);

  const handleUpdateCollection = (printId: string, delta: number) => {
    setCollection((prev) => {
      const nextVal = Math.max(0, (prev[printId] ?? 0) + delta);
      const next = { ...prev };
      if (nextVal === 0) {
        delete next[printId];
      } else {
        next[printId] = nextVal;
      }
      return next;
    });
  };

  const activeDeck = decks.find((d) => d.id === activeDeckId) ?? decks[0];

  const handleAddToActiveDeck = (card: GundamCardPrint) => {
    if (!activeDeck) return;
    const isResource = card.type === 'RESOURCE';
    const maxCopy = isResource ? 10 : 4;
    const targetList = isResource ? [...activeDeck.resourceDeck] : [...activeDeck.mainDeck];
    const idx = targetList.findIndex((e) => e.cardNo === card.cardNo);

    if (idx === -1) {
      targetList.push({ cardNo: card.cardNo, printId: card.printId, qty: 1 });
    } else if (targetList[idx].qty < maxCopy) {
      targetList[idx] = { ...targetList[idx], qty: targetList[idx].qty + 1 };
    } else {
      setSyncNotice(`${card.cardNo} (${card.name}) is already at ${maxCopy} copies in ${activeDeck.name}.`);
      return;
    }

    const updated: SavedDeck = {
      ...activeDeck,
      updatedAt: new Date().toISOString(),
      mainDeck: isResource ? activeDeck.mainDeck : targetList,
      resourceDeck: isResource ? targetList : activeDeck.resourceDeck,
    };
    setDecks((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    setSyncNotice(`Added 1× ${card.name} to "${activeDeck.name}".`);
  };

  const handleSaveDeck = (updated: SavedDeck) => {
    setDecks((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  };

  const handleCreateDeck = (newDeck: SavedDeck) => {
    setDecks((prev) => [newDeck, ...prev]);
    setActiveDeckId(newDeck.id);
  };

  const handleDeleteDeck = (id: string) => {
    setDecks((prev) => {
      const remaining = prev.filter((d) => d.id !== id);
      if (activeDeckId === id) {
        setActiveDeckId(remaining[0]?.id ?? '');
      }
      return remaining;
    });
  };

  const handleImportBackup = (data: { collection?: CollectionMap; decks?: SavedDeck[] }) => {
    if (data.collection) setCollection(data.collection);
    if (data.decks && data.decks.length > 0) {
      setDecks(data.decks);
      setActiveDeckId(data.decks[0].id);
    }
  };

  const handleSyncOfficial = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncNotice('Syncing official Asia-English catalog from gundam-gcg.com...');
    try {
      const res = await fetch('/api/cards/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      if (!res.ok) throw new Error('Sync error');
      const data = await res.json();
      if (data.catalog) {
        setCatalog(data.catalog);
      }
      setSyncNotice(
        `Sync complete: ${data.totalPrints} official prints indexed (${data.addedCount} new, ${data.updatedCount} updated).`
      );
    } catch {
      setSyncNotice('Unable to reach gundam-gcg.com right now; using local catalog.');
    } finally {
      setSyncing(false);
    }
  };

  const inspectedGroup = inspected ? cardGroupsByNo.get(inspected.cardNo) : undefined;

  return (
    <div className="min-h-screen bg-[#0B0E14] text-slate-100">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0B0E14]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single text wordmark */}
          <Link
            href="/"
            className="font-display text-xl font-bold tracking-wide text-white whitespace-nowrap shrink-0"
          >
            Gundam Card Atlas
          </Link>

          {/* Zone 2: Clean single-line text nav links */}
          <nav className="flex items-center gap-7 text-sm font-medium">
            {[
              { id: 'catalog', label: 'Catalog' },
              { id: 'deck', label: 'Deck Builder' },
              { id: 'collection', label: 'Collection' },
            ].map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id as typeof activeTab)}
                  className={`relative py-1 transition-colors whitespace-nowrap shrink-0 ${
                    active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>{item.label}</span>
                  {active && (
                    <span className="absolute inset-x-0 -bottom-[15px] h-0.5 bg-blue-500" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handleSyncOfficial}
              disabled={syncing}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync Cards'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {/* Quiet context strip */}
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.06] pb-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-wide text-white sm:text-3xl">
              {activeTab === 'catalog'
                ? 'Official English Card Catalog'
                : activeTab === 'deck'
                ? 'Strategy Deck Builder & Tactical Analyzer'
                : 'Personal Collection Tracker'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-400 font-mono tabular-nums">
              {catalog.totalPrints} official prints · {catalog.packages.length} Asia-English products · Updated{' '}
              {catalog.syncedAt.slice(0, 10)}
            </p>
          </div>
          {syncNotice && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-400" />
              <span>{syncNotice}</span>
              <button
                type="button"
                onClick={() => setSyncNotice(null)}
                className="ml-1 text-blue-300 hover:text-white"
                aria-label="Dismiss message"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {activeTab === 'catalog' && (
          <CatalogWorkspace
            cards={catalog.cards}
            packages={catalog.packages}
            collection={collection}
            onUpdateCollection={handleUpdateCollection}
            onInspectCard={(cardNo, printId) => setInspected({ cardNo, printId })}
            onAddToDeck={activeDeck ? handleAddToActiveDeck : undefined}
            activeDeckName={activeDeck?.name}
          />
        )}

        {activeTab === 'deck' && (
          <DeckWorkspace
            allCards={catalog.cards}
            decks={decks}
            activeDeckId={activeDeck?.id ?? ''}
            onSelectDeck={setActiveDeckId}
            onSaveDeck={handleSaveDeck}
            onCreateDeck={handleCreateDeck}
            onDeleteDeck={handleDeleteDeck}
            onInspectCard={(cardNo, printId) => setInspected({ cardNo, printId })}
          />
        )}

        {activeTab === 'collection' && (
          <CollectionWorkspace
            cards={catalog.cards}
            packages={catalog.packages}
            collection={collection}
            decks={decks}
            onUpdateCollection={handleUpdateCollection}
            onImportBackup={handleImportBackup}
            onInspectCard={(cardNo, printId) => setInspected({ cardNo, printId })}
          />
        )}
      </main>

      {/* Card Detail Drawer */}
      {inspectedGroup && (
        <CardDetailDrawer
          key={inspectedGroup.cardNo}
          group={inspectedGroup}
          initialPrintId={inspected?.printId}
          allCards={catalog.cards}
          collection={collection}
          onUpdateCollection={handleUpdateCollection}
          onAddToDeck={activeDeck ? handleAddToActiveDeck : undefined}
          activeDeckName={activeDeck?.name}
          onSelectCardNo={(cardNo) => setInspected({ cardNo })}
          onClose={() => setInspected(null)}
        />
      )}
    </div>
  );
}
