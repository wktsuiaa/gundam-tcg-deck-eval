'use client';

import React, { useMemo, useState } from 'react';
import { X, BookOpen, ExternalLink, Search, ShieldCheck } from 'lucide-react';
import type { RulesPayload } from '@/types/gundam';

interface RulesModalProps {
  rules: RulesPayload;
  onClose: () => void;
}

export function RulesModal({ rules, onClose }: RulesModalProps) {
  const [faqQuery, setFaqQuery] = useState('');
  const [tab, setTab] = useState<'overview' | 'faqs'>('overview');

  const filteredFaqs = useMemo(() => {
    const q = faqQuery.trim().toLowerCase();
    if (!q) return rules.generalFaqs.slice(0, 60);
    return rules.generalFaqs
      .filter(
        (f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [rules.generalFaqs, faqQuery]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Official Gundam GCG Rules"
    >
      <div
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0F141E] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-blue-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Official Gundam GCG Rules &amp; FAQs
              </h2>
              <p className="text-[11px] font-mono text-slate-400">
                Synced {rules.syncedAt.slice(0, 10)} · {rules.generalFaqs.length} general FAQs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
            aria-label="Close rules modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] bg-[#131822] px-6 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('overview')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                tab === 'overview'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Deck Rules &amp; Turn Phases
            </button>
            <button
              type="button"
              onClick={() => setTab('faqs')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                tab === 'faqs'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              General Rules FAQs ({rules.generalFaqs.length})
            </button>
          </div>
          <a
            href={rules.source}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200 whitespace-nowrap"
          >
            <span>gundam-gcg.com/rules</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-6">
          {tab === 'overview' ? (
            <>
              {/* Deck Construction Parameters */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Tournament Deck Construction Rules</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-white/[0.07] bg-[#131822] p-3">
                    <div className="text-[11px] text-slate-400">Main Deck</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-white tabular-nums">
                      {rules.deckConstruction.mainDeckSize} cards
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.07] bg-[#131822] p-3">
                    <div className="text-[11px] text-slate-400">Resource Deck</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-white tabular-nums">
                      {rules.deckConstruction.resourceDeckSize} cards
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.07] bg-[#131822] p-3">
                    <div className="text-[11px] text-slate-400">Max Colors</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-white tabular-nums">
                      {rules.deckConstruction.maxColors} colors
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.07] bg-[#131822] p-3">
                    <div className="text-[11px] text-slate-400">Copy Limit</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-white tabular-nums">
                      {rules.deckConstruction.maxCopiesPerCardNo} per Card No.
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-400">
                  Opening Hand: {rules.deckConstruction.startingHandSize} cards (1 mulligan permitted) · Starting Shields:{' '}
                  {rules.deckConstruction.startingShieldCount} cards · Resource Deck holds RESOURCE cards only.
                </p>
              </div>

              {/* Turn Phases */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Turn Structure &amp; Phases
                </h3>
                <div className="space-y-2">
                  {rules.deckConstruction.turnPhases.map((tp, idx) => (
                    <div
                      key={tp.phase}
                      className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-[#131822] px-4 py-3 text-xs"
                    >
                      <span className="font-mono font-bold text-blue-400 tabular-nums shrink-0">
                        0{idx + 1}
                      </span>
                      <div>
                        <div className="font-semibold text-white">{tp.phase}</div>
                        <div className="mt-0.5 text-slate-300 leading-relaxed">{tp.summary}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Official PDF Documents */}
              {rules.documents.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Official Comprehensive Rulebooks &amp; Manuals
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {rules.documents.map((doc) => (
                      <a
                        key={doc.url}
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-[#131822] px-3.5 py-2.5 text-xs text-slate-200 hover:border-blue-500/50 hover:text-white transition-colors"
                      >
                        <span className="truncate font-medium">{doc.title}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Scraped Rule Sections */}
              {rules.sections.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Official Rules Sections
                  </h3>
                  <div className="space-y-2">
                    {rules.sections.map((sec) => (
                      <div
                        key={sec.id}
                        className="rounded-lg border border-white/[0.06] bg-[#131822] p-3.5 text-xs space-y-1"
                      >
                        <div className="font-semibold text-white">{sec.title}</div>
                        <p className="text-slate-300 leading-relaxed">{sec.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={faqQuery}
                  onChange={(e) => setFaqQuery(e.target.value)}
                  placeholder="Search official rules FAQs (e.g. Link, Pair, Blocker, Mulligan, Shield)..."
                  className="w-full rounded-lg border border-white/10 bg-[#131822] py-2 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="space-y-2.5">
                {filteredFaqs.map((faq, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-white/[0.06] bg-[#131822] p-3.5 text-xs space-y-1.5"
                  >
                    <div className="font-medium text-slate-100">{faq.q}</div>
                    <div className="text-slate-300 leading-relaxed">{faq.a}</div>
                  </div>
                ))}
                {filteredFaqs.length === 0 && (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No official FAQs match &ldquo;{faqQuery}&rdquo;.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
