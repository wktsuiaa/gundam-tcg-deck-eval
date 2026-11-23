'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lock,
  Pencil,
  Search,
  Wand2,
} from 'lucide-react';
import { motion } from 'motion/react';
import type {
  CardColor,
  DeckGenerationConstraints,
  EffectStyleTag,
  GundamPackage,
  PacingTier,
  StrategyBlueprint,
  TacticalStyleTag,
} from '@/types/gundam';
import {
  type ConstraintFeasibility,
  EFFECT_STYLE_META,
  TACTICAL_STYLE_META,
} from '@/lib/deck-engine';
import { CARD_COLOR_META } from '@/lib/gundam-keywords';
import { HEXAGON_AXIS_META } from '@/components/HexagonRadar';

const COLORS: CardColor[] = ['Blue', 'Green', 'Red', 'Purple', 'White'];
const PACING_OPTIONS: PacingTier[] = [
  'Early Rush',
  'Midrange Tempo',
  'Late-Game Control',
  'Ramp / Combo',
];

type WorkflowStep = 1 | 2 | 3 | 4;

const WORKFLOW_STEPS: { id: WorkflowStep; shortTitle: string; title: string }[] = [
  { id: 1, shortTitle: 'Identity & Curve', title: '01. Identity & Curve' },
  { id: 2, shortTitle: 'Strategy & Effects', title: '02. Strategy & Effects' },
  { id: 3, shortTitle: 'Constraints', title: '03. Constraints' },
  { id: 4, shortTitle: 'Tune & Generate', title: '04. Tune & Generate' },
];

interface StrategyGeneratorPanelProps {
  open: boolean;
  onToggleOpen: () => void;
  blueprint: StrategyBlueprint;
  packages: GundamPackage[];
  topTraits: string[];
  feasibility: ConstraintFeasibility;
  onUpdateBlueprint: (patch: Partial<StrategyBlueprint>) => void;
  onUpdateConstraints: (patch: Partial<DeckGenerationConstraints>) => void;
  onGenerate: () => void;
}

export function StrategyGeneratorPanel({
  open,
  onToggleOpen,
  blueprint,
  packages,
  topTraits,
  feasibility,
  onUpdateBlueprint,
  onUpdateConstraints,
  onGenerate,
}: StrategyGeneratorPanelProps) {
  const [step, setStep] = useState<WorkflowStep>(1);
  const [traitQuery, setTraitQuery] = useState('');

  const activeStrategy = blueprint.styles[0] ?? 'Link-Strike';
  const atMaxEffects = blueprint.effectStyles.length >= 2;

  const availableTraits = useMemo(() => {
    const merged = new Set<string>([...blueprint.traitFocus, ...topTraits]);
    const list = [...merged];
    const q = traitQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((tr) => tr.toLowerCase().includes(q));
  }, [topTraits, blueprint.traitFocus, traitQuery]);

  const selectStrategy = (tag: TacticalStyleTag) => {
    onUpdateBlueprint({ styles: [tag] });
  };

  const toggleEffectStyle = (tag: EffectStyleTag) => {
    const isSelected = blueprint.effectStyles.includes(tag);
    if (isSelected) {
      onUpdateBlueprint({
        effectStyles: blueprint.effectStyles.filter((s) => s !== tag),
      });
      return;
    }
    if (blueprint.effectStyles.length >= 2) return;
    onUpdateBlueprint({ effectStyles: [...blueprint.effectStyles, tag] });
  };

  const toggleTraitFocus = (trait: string) => {
    const exists = blueprint.traitFocus.includes(trait);
    const next = exists
      ? blueprint.traitFocus.filter((t) => t !== trait)
      : [...blueprint.traitFocus, trait];
    onUpdateBlueprint({ traitFocus: next });
  };

  const toggleAllowedSet = (code: string) => {
    const prev = blueprint.constraints.allowedPackageCodes;
    const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
    onUpdateConstraints({ allowedPackageCodes: next });
  };

  const activeConstraintSummary = useMemo(() => {
    const parts: string[] = [];
    if (blueprint.constraints.allowedPackageCodes.length > 0) {
      parts.push(`${blueprint.constraints.allowedPackageCodes.length} set(s)`);
    } else {
      parts.push('All sets');
    }
    parts.push(`Max ×${blueprint.constraints.maxCopiesPerCard}`);
    if (blueprint.constraints.maxCost !== null) {
      parts.push(`Cost ≤ ${blueprint.constraints.maxCost}`);
    }
    if (blueprint.constraints.maxLv !== null) {
      parts.push(`Lv. ≤ ${blueprint.constraints.maxLv}`);
    }
    if (blueprint.constraints.rarityCap !== 'ALL') {
      parts.push(
        blueprint.constraints.rarityCap === 'NO_LR' ? 'No LR' : 'C/U/R Only'
      );
    }
    if (blueprint.constraints.strictTraitLinkLock) {
      parts.push('Strict Lock');
    }
    return parts.join(' · ');
  }, [blueprint.constraints]);

  const nextStepMeta = WORKFLOW_STEPS.find((s) => s.id === step + 1);

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#131822]">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Wand2 className="h-4 w-4 text-blue-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-white truncate">
              Strategy &amp; Constraints Deck Generator
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              4-step deck workflow · 1 Build Strategy · Up to 2 Effect Styles · Multi-Trait OR Coherence
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-300 shrink-0">
          <span className="hidden md:inline font-mono tabular-nums text-[11px] text-slate-400 whitespace-nowrap">
            {blueprint.colors.length > 0 ? blueprint.colors.join('/') : 'Auto Best 2'} ·{' '}
            {activeStrategy} · {blueprint.effectStyles.length}/2 effects ·{' '}
            {blueprint.traitFocus.length === 0
              ? 'Any Trait'
              : `${blueprint.traitFocus.length} trait(s)`}
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.08] p-5 space-y-5">
          {/* Stepper Bar (Free-jump across all 4 steps) */}
          <nav
            aria-label="Deck generator workflow steps"
            className="grid grid-cols-2 gap-2 lg:grid-cols-4"
          >
            {WORKFLOW_STEPS.map((item) => {
              const isCurrent = step === item.id;
              const isVisited = step > item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStep(item.id)}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isCurrent
                      ? 'border-blue-500/70 bg-blue-600 text-white'
                      : isVisited
                      ? 'border-emerald-500/30 bg-[#0B0E14] text-slate-200 hover:border-white/25'
                      : 'border-white/[0.08] bg-[#0B0E14] text-slate-400 hover:border-white/20 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate">{item.title}</span>
                  {isVisited && !isCurrent && (
                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Active Step Viewport */}
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-5"
          >
            {/* STEP 1: IDENTITY & CURVE */}
            {step === 1 && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-6 space-y-5">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-300">
                      Target Colors (1–2 colors or Auto Best 2)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => onUpdateBlueprint({ colors: [] })}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                          blueprint.colors.length === 0
                            ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                            : 'border-white/10 bg-[#0B0E14] text-slate-400 hover:text-white'
                        }`}
                      >
                        Any (Auto Best 2)
                      </button>
                      {COLORS.map((col) => {
                        const selected = blueprint.colors.includes(col);
                        const meta = CARD_COLOR_META[col];
                        return (
                          <button
                            key={col}
                            type="button"
                            onClick={() => {
                              const next = selected
                                ? blueprint.colors.filter((c) => c !== col)
                                : blueprint.colors.length < 2
                                ? [...blueprint.colors, col]
                                : [blueprint.colors[1], col];
                              onUpdateBlueprint({ colors: next });
                            }}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                              selected
                                ? `${meta.softBg} ${meta.border} text-white`
                                : 'border-white/10 bg-[#0B0E14] text-slate-400 hover:text-white'
                            }`}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-xs shrink-0"
                              style={{ backgroundColor: meta.hex }}
                            />
                            <span>{col}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-300">
                      Target Pacing
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {PACING_OPTIONS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => onUpdateBlueprint({ pacing: p })}
                          className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                            blueprint.pacing === p
                              ? 'border-blue-500/60 bg-blue-500/15 text-white'
                              : 'border-white/10 bg-[#0B0E14] text-slate-300 hover:bg-white/[0.04]'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-6 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-medium text-slate-300">
                      Trait Focus (Multi-Select OR Coherence Anchor)
                    </label>
                    <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                      <span className="text-slate-400">
                        {blueprint.traitFocus.length === 0
                          ? 'Any Trait'
                          : `${blueprint.traitFocus.length} selected`}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateBlueprint({ traitFocus: [] })}
                        disabled={blueprint.traitFocus.length === 0}
                        className="font-sans text-blue-400 hover:text-blue-300 disabled:opacity-40 whitespace-nowrap"
                      >
                        Any Trait (Reset)
                      </button>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={traitQuery}
                      onChange={(e) => setTraitQuery(e.target.value)}
                      placeholder="Filter traits (e.g. Zeon, White Base Team, SEED)..."
                      aria-label="Filter traits"
                      className="w-full rounded-lg border border-white/10 bg-[#0B0E14] py-2 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
                    {availableTraits.length === 0 ? (
                      <div className="col-span-full py-6 text-center text-xs text-slate-500">
                        No traits match &ldquo;{traitQuery}&rdquo;.
                      </div>
                    ) : (
                      availableTraits.map((tr) => {
                        const selected = blueprint.traitFocus.includes(tr);
                        return (
                          <button
                            key={tr}
                            type="button"
                            onClick={() => toggleTraitFocus(tr)}
                            aria-pressed={selected}
                            className={`flex items-center justify-between gap-1.5 rounded-md border px-2.5 py-2 text-left text-[11px] font-medium transition-colors ${
                              selected
                                ? 'border-blue-500/60 bg-blue-500/15 text-white'
                                : 'border-white/[0.07] bg-[#0B0E14] text-slate-300 hover:border-white/20'
                            }`}
                          >
                            <span className="truncate">{tr}</span>
                            {selected && (
                              <Check className="h-3 w-3 text-blue-400 shrink-0" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Matches cards carrying any selected trait plus Pilot–Unit Link partners (Series excluded).
                  </p>
                </div>
              </div>
            )}

            {/* STEP 2: STRATEGY (SELECT 1) & EFFECT STYLES (MAX 2) */}
            {step === 2 && (
              <div className="space-y-6">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-slate-300">
                      Build Deck Strategy (select 1)
                    </label>
                    <span className="text-[11px] font-mono tabular-nums text-blue-300">
                      Selected: {activeStrategy}
                    </span>
                  </div>
                  <div
                    role="radiogroup"
                    aria-label="Build Deck Strategy"
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
                  >
                    {TACTICAL_STYLE_META.map((item) => {
                      const active = activeStrategy === item.tag;
                      return (
                        <button
                          key={item.tag}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => selectStrategy(item.tag)}
                          className={`rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            active
                              ? 'border-blue-500/70 bg-blue-500/15 text-white'
                              : 'border-white/[0.07] bg-[#0B0E14] text-slate-300 hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold">{item.tag}</span>
                            {active && (
                              <Check className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                            )}
                          </div>
                          <p className="mt-1 text-[11px] leading-snug text-slate-400">
                            {item.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2.5 border-t border-white/[0.08] pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-medium text-slate-300">
                      Effect Styles (optional · select up to 2 card mechanics)
                    </label>
                    <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                      <span
                        className={
                          atMaxEffects ? 'text-emerald-300' : 'text-slate-400'
                        }
                      >
                        {blueprint.effectStyles.length}/2 selected
                      </span>
                      {blueprint.effectStyles.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onUpdateBlueprint({ effectStyles: [] })}
                          className="font-sans text-blue-400 hover:text-blue-300 whitespace-nowrap"
                        >
                          Clear Effects
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {EFFECT_STYLE_META.map((ef) => {
                      const active = blueprint.effectStyles.includes(ef.tag);
                      const disabled = !active && atMaxEffects;
                      return (
                        <button
                          key={ef.tag}
                          type="button"
                          disabled={disabled}
                          aria-pressed={active}
                          onClick={() => toggleEffectStyle(ef.tag)}
                          className={`rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                            active
                              ? 'border-emerald-500/60 bg-emerald-500/12 text-white'
                              : disabled
                              ? 'border-white/[0.04] bg-[#0B0E14]/50 text-slate-500 opacity-45 cursor-not-allowed'
                              : 'border-white/[0.07] bg-[#0B0E14] text-slate-300 hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold">{ef.label}</span>
                            {active && (
                              <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            )}
                          </div>
                          <p
                            className={`mt-1 text-[11px] leading-snug ${
                              disabled ? 'text-slate-600' : 'text-slate-400'
                            }`}
                          >
                            {ef.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: CONSTRAINTS */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-200">
                    Deck Generation Limitations &amp; Constraints
                  </h3>
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    Official 50+10 · ≤2 Colors · ≤4 Copies
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Max Copies
                    </label>
                    <select
                      value={blueprint.constraints.maxCopiesPerCard}
                      onChange={(e) =>
                        onUpdateConstraints({
                          maxCopiesPerCard: Number(e.target.value) as 1 | 2 | 3 | 4,
                        })
                      }
                      className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-white font-mono"
                    >
                      <option value={4}>4 (Official)</option>
                      <option value={3}>3 copies</option>
                      <option value={2}>2 copies</option>
                      <option value={1}>1 (Highlander)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Max Cost
                    </label>
                    <select
                      value={blueprint.constraints.maxCost ?? ''}
                      onChange={(e) =>
                        onUpdateConstraints({
                          maxCost: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-white font-mono"
                    >
                      <option value="">No Cap</option>
                      {[2, 3, 4, 5, 6].map((n) => (
                        <option key={n} value={n}>
                          Cost ≤ {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Max Lv.
                    </label>
                    <select
                      value={blueprint.constraints.maxLv ?? ''}
                      onChange={(e) =>
                        onUpdateConstraints({
                          maxLv: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-white font-mono"
                    >
                      <option value="">No Cap</option>
                      {[3, 4, 5, 6, 7].map((n) => (
                        <option key={n} value={n}>
                          Lv. ≤ {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Rarity Cap
                    </label>
                    <select
                      value={blueprint.constraints.rarityCap}
                      onChange={(e) =>
                        onUpdateConstraints({
                          rarityCap: e.target.value as DeckGenerationConstraints['rarityCap'],
                        })
                      }
                      className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-white"
                    >
                      <option value="ALL">All Rarities</option>
                      <option value="NO_LR">Budget (No LR)</option>
                      <option value="C_U_R_ONLY">C / U / R Only</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      Allowed Set Pool (
                      {blueprint.constraints.allowedPackageCodes.length === 0
                        ? 'All Sets'
                        : `${blueprint.constraints.allowedPackageCodes.length} selected`}
                      )
                    </span>
                    {blueprint.constraints.allowedPackageCodes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onUpdateConstraints({ allowedPackageCodes: [] })}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Reset to All Sets
                      </button>
                    )}
                  </div>
                  <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                    {packages.map((pkg) => {
                      const active = blueprint.constraints.allowedPackageCodes.includes(
                        pkg.code
                      );
                      return (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => toggleAllowedSet(pkg.code)}
                          className={`rounded border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                            active
                              ? 'border-blue-500/60 bg-blue-500/20 text-blue-200'
                              : 'border-white/[0.08] bg-[#0B0E14] text-slate-400 hover:text-white'
                          }`}
                        >
                          {pkg.code}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-start gap-2.5 rounded-lg border border-white/[0.08] bg-[#0B0E14] p-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={blueprint.constraints.strictTraitLinkLock}
                    onChange={(e) =>
                      onUpdateConstraints({ strictTraitLinkLock: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 accent-blue-500"
                  />
                  <div>
                    <div className="flex items-center gap-1.5 font-medium text-white">
                      <Lock className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                      <span>Strict Trait / Link Lock</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {blueprint.traitFocus.length > 0
                        ? `Restricts the pool to cards matching (${blueprint.traitFocus.join(' OR ')}) and their Pilot–Unit Link partners. Never filters by Series.`
                        : 'No Trait Focus picked — locks Units and Pilots to valid Pilot–Unit Link pairs within the pool. Never filters by Series.'}
                    </p>
                  </div>
                </label>

                <div
                  className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
                    feasibility.feasible
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-red-500/40 bg-red-500/10 text-red-200'
                  }`}
                >
                  {feasibility.feasible ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  )}
                  <span>
                    <strong>Pool Feasibility:</strong> {feasibility.reason}
                  </span>
                </div>
              </div>
            )}

            {/* STEP 4: TUNE & GENERATE */}
            {step === 4 && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Compact Blueprint Summary with 1-click jump back to Steps 1-3 */}
                <div className="lg:col-span-6 space-y-3">
                  <h3 className="text-xs font-semibold text-slate-200">
                    Blueprint Summary (click any section to adjust)
                  </h3>
                  <div className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.08] bg-[#0B0E14]">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-[11px] font-medium text-slate-400">
                          01. Identity &amp; Curve
                        </div>
                        <div className="text-xs text-white">
                          {blueprint.colors.length > 0
                            ? blueprint.colors.join(' / ')
                            : 'Any (Auto Best 2)'}{' '}
                          · {blueprint.pacing}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          Traits:{' '}
                          {blueprint.traitFocus.length > 0
                            ? blueprint.traitFocus.join(' OR ')
                            : 'Any Trait / Faction'}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 shrink-0">
                        <Pencil className="h-3 w-3" />
                        <span>Edit</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-[11px] font-medium text-slate-400">
                          02. Strategy &amp; Effects
                        </div>
                        <div className="text-xs text-white">{activeStrategy}</div>
                        <div className="text-[11px] text-slate-400">
                          Effects:{' '}
                          {blueprint.effectStyles.length > 0
                            ? blueprint.effectStyles.join(' · ')
                            : 'None selected (optional)'}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 shrink-0">
                        <Pencil className="h-3 w-3" />
                        <span>Edit</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-[11px] font-medium text-slate-400">
                          03. Constraints
                        </div>
                        <div className="text-xs text-white font-mono">
                          {activeConstraintSummary}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 shrink-0">
                        <Pencil className="h-3 w-3" />
                        <span>Edit</span>
                      </span>
                    </button>
                  </div>
                </div>

                {/* Target Hexagon Sliders + Feasibility & Generate CTA */}
                <div className="lg:col-span-6 flex flex-col justify-between space-y-4">
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold text-slate-200">
                      Target 6-Axis Hexagon Weights
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-white/[0.08] bg-[#0B0E14] p-3.5">
                      {HEXAGON_AXIS_META.map((ax) => (
                        <div key={ax.key} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-300">{ax.shortLabel}</span>
                            <span className="font-mono tabular-nums text-amber-300">
                              {blueprint.targetHexagon[ax.key]}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={15}
                            max={95}
                            step={5}
                            value={blueprint.targetHexagon[ax.key]}
                            onChange={(e) =>
                              onUpdateBlueprint({
                                targetHexagon: {
                                  ...blueprint.targetHexagon,
                                  [ax.key]: Number(e.target.value),
                                },
                              })
                            }
                            className="w-full accent-amber-400"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug ${
                        feasibility.feasible
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                          : 'border-red-500/40 bg-red-500/10 text-red-200'
                      }`}
                    >
                      {feasibility.feasible ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                      )}
                      <span>{feasibility.reason}</span>
                    </div>
                    <button
                      type="button"
                      onClick={onGenerate}
                      disabled={!feasibility.feasible}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 transition-colors whitespace-nowrap"
                    >
                      <Wand2 className="h-4 w-4 shrink-0" />
                      <span>Generate Legal 50+10 Deck</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Workflow Step Footer Controls */}
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3.5">
            <button
              type="button"
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as WorkflowStep) : s))}
              disabled={step === 1}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0E14] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.06] disabled:opacity-35 transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back</span>
            </button>

            <span className="text-[11px] font-mono tabular-nums text-slate-400">
              Step {step} of 4
            </span>

            {nextStepMeta ? (
              <button
                type="button"
                onClick={() => setStep(nextStepMeta.id)}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 transition-colors whitespace-nowrap"
              >
                <span>Next: {nextStepMeta.shortTitle}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <span className="text-[11px] text-slate-400 whitespace-nowrap">
                Ready to generate
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
