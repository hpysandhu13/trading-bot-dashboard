// Signal Engine — EURUSD News-Based Trade Signal Generator
(function (global) {
  'use strict';

  // ── Keyword Dictionary ───────────────────────────────────────────────────────
  // Positive score → Bullish EUR/USD (BUY), Negative → Bearish (SELL)
  const KEYWORDS = [
    // ─ Strong Bullish EUR ─
    { p: /ecb rate hike|ecb raises? rates?|ecb hikes?/i,                weight:  3 },
    { p: /lagarde.*hawkish|hawkish.*lagarde/i,                           weight:  3 },
    { p: /ecb hawkish|hawkish.*ecb/i,                                    weight:  3 },
    { p: /eurozone gdp (beat|surpass|exceed|growth|above)/i,             weight:  3 },
    { p: /eur.*inflation (high|surge|beat|rise)/i,                       weight:  2 },
    { p: /eurozone pmi (beat|above|strong|expansion)/i,                  weight:  2 },
    { p: /eurozone.*surplus|trade.*surplus.*euro/i,                      weight:  2 },
    { p: /euro.?zone.*(strong|robust|resilient)/i,                       weight:  2 },
    { p: /eu.*economy (expands?|grows?|beats?)/i,                        weight:  2 },
    { p: /dollar (weakness|weakens?|falls?|drops?|slides?|retreats?)/i,  weight:  2 },
    { p: /usd (weakness|weakens?|falls?|drops?|slides?|retreats?)/i,     weight:  2 },
    { p: /fed (dovish|pivot|pause|hold|cut)/i,                           weight:  2 },
    { p: /us.*jobs (miss|disappoint|fall|weak|below)/i,                  weight:  2 },
    { p: /us.*gdp (miss|contract|shrink|weak|below)/i,                   weight:  2 },
    { p: /euro (gains?|rises?|rallies?|climbs?|surges?|strengthens?)/i,  weight:  2 },
    { p: /eur.?usd (gains?|rises?|rallies?|climbs?|surges?)/i,           weight:  2 },
    { p: /risk.?on|risk appetite (improves?|rises?|climbs?)/i,           weight:  1 },
    { p: /inflation (cools?|falls?|drops?|eases?|softens?)/i,            weight:  1 },
    { p: /ecb (meeting|decision|statement|press conference)/i,           weight:  1 },

    // ─ Strong Bearish EUR ─
    { p: /ecb rate cut|ecb lowers? rates?|ecb cuts? rates?/i,            weight: -3 },
    { p: /ecb (cut|cuts?|lower|dovish|pause|hold)/i,                     weight: -3 },
    { p: /lagarde.*dovish|dovish.*lagarde/i,                             weight: -3 },
    { p: /eurozone (recession|contraction|shrinks?|gdp miss|gdp below)/i,weight: -3 },
    { p: /germany.*(recession|gdp miss|contract|shrink|weak)/i,          weight: -2 },
    { p: /fed rate hike|fed raises? rates?|fed hikes?/i,                 weight: -3 },
    { p: /fed (hike|hawkish|raise|tighten)/i,                            weight: -2 },
    { p: /powell.*hawkish|hawkish.*powell/i,                             weight: -3 },
    { p: /us.*nfp (beat|strong|surpass|exceed|above)/i,                  weight: -2 },
    { p: /us.*jobs (beat|strong|surpass|exceed|above)/i,                 weight: -2 },
    { p: /us.*gdp (beat|strong|surpass|exceed|above)/i,                  weight: -2 },
    { p: /dollar (strength|strengthens?|rises?|gains?|rallies?)/i,       weight: -2 },
    { p: /usd (strength|strengthens?|rises?|gains?|rallies?)/i,          weight: -2 },
    { p: /euro.?zone.*(weak|struggling|crisis|trouble)/i,                weight: -2 },
    { p: /eurozone pmi (miss|below|weak|contraction)/i,                  weight: -2 },
    { p: /eu.*economy (contracts?|shrinks?|misses?|slows?)/i,            weight: -2 },
    { p: /eu.*crisis|euro.?zone.*crisis/i,                               weight: -2 },
    { p: /euro (falls?|drops?|slides?|weakens?|tumbles?|retreats?)/i,    weight: -2 },
    { p: /eur.?usd (falls?|drops?|slides?|weakens?|tumbles?)/i,          weight: -2 },
    { p: /risk.?off|flight to (safety|quality)|safe.?haven demand/i,     weight: -1 },
    { p: /trade (war|tariff|sanction|escalat)/i,                         weight: -1 },
    { p: /geopolit|ukraine|russia|middle east|war/i,                     weight: -1 },
    { p: /cpi (beat|high|surge|above|hot)/i,                             weight: -1 }, // US high CPI → Fed hike → USD up
    { p: /unemployment (falls?|drops?|low|beat|strong)/i,               weight: -1 }, // US low unemployment → USD up
    { p: /fomc (meeting|decision|statement|minutes)/i,                   weight: -1 },
  ];

  // ── Scoring ──────────────────────────────────────────────────────────────────
  function scoreHeadline(title) {
    let score = 0;
    const matched = [];
    KEYWORDS.forEach(function (kw) {
      if (kw.p.test(title)) {
        score += kw.weight;
        matched.push({ term: kw.p.toString(), weight: kw.weight });
      }
    });
    return { score: score, matched: matched };
  }

  // ── Classification ───────────────────────────────────────────────────────────
  function classifySignal(score) {
    if (score >= 4)  return { label: 'STRONG BUY',  dir: 'BUY',  strength: 'strong' };
    if (score >= 2)  return { label: 'BUY',          dir: 'BUY',  strength: 'weak'   };
    if (score <= -4) return { label: 'STRONG SELL', dir: 'SELL', strength: 'strong' };
    if (score <= -2) return { label: 'SELL',         dir: 'SELL', strength: 'weak'   };
    return { label: 'NEUTRAL', dir: 'NEUTRAL', strength: 'none' };
  }

  // ── TP / SL pip constants ────────────────────────────────────────────────────
  // Strong signals warrant wider targets; weak signals use tighter levels.
  // R:R is always ≥ 1.5 to remain profitable below 60% win rate.
  var STRONG_TP_PIPS = 25; // take-profit distance for strong signals
  var STRONG_SL_PIPS = 15; // stop-loss  distance for strong signals  (R:R 1.67)
  var WEAK_TP_PIPS   = 12; // take-profit distance for weak   signals
  var WEAK_SL_PIPS   = 8;  // stop-loss  distance for weak   signals  (R:R 1.50)

  // ── TP / SL Calculator ───────────────────────────────────────────────────────
  // 1 pip = 0.0001 for EUR/USD
  function computeTPSL(dir, strength, entryPrice) {
    if (dir === 'NEUTRAL') return null;
    var pip     = 0.0001;
    var tpPips  = strength === 'strong' ? STRONG_TP_PIPS : WEAK_TP_PIPS;
    var slPips  = strength === 'strong' ? STRONG_SL_PIPS : WEAK_SL_PIPS;
    var mult    = dir === 'BUY' ? 1 : -1;
    return {
      entry:  entryPrice,
      tp:     parseFloat((entryPrice + mult * tpPips * pip).toFixed(5)),
      sl:     parseFloat((entryPrice - mult * slPips * pip).toFixed(5)),
      tpPips: tpPips,
      slPips: slPips,
      rr:     (tpPips / slPips).toFixed(2),
    };
  }

  // ── Momentum Buffer ──────────────────────────────────────────────────────────
  // Tracks scored headlines within a rolling 5-minute window
  var MOMENTUM_WINDOW_MS = 5 * 60 * 1000;
  var momentumBuffer = [];

  function pushMomentum(ts, score, dir, title) {
    var cutoff = ts - MOMENTUM_WINDOW_MS;
    momentumBuffer = momentumBuffer.filter(function (m) { return m.ts >= cutoff; });
    momentumBuffer.push({ ts: ts, score: score, dir: dir, title: title });
  }

  function getMomentum(dir) {
    var cutoff = Date.now() - MOMENTUM_WINDOW_MS;
    return momentumBuffer.filter(function (m) { return m.ts >= cutoff && m.dir === dir; });
  }

  // ── Confidence Score (0–100) ─────────────────────────────────────────────────
  // Weighting rationale:
  //   BASE_CONFIDENCE          (15) — minimum for any non-neutral signal
  //   MAX_SCORE_CONTRIBUTION   (40) — a keyword score of 6+ saturates this bucket
  //   SCORE_MULTIPLIER          (7) — each unit of absolute score ≈ 7 confidence pts
  //   MAX_MOMENTUM_CONTRIBUTION(45) — each additional corroborating headline adds 15 pts
  //   Near-event penalty       (×0.6) — volatility makes signals less reliable
  var BASE_CONFIDENCE           = 15;
  var MAX_SCORE_CONTRIBUTION    = 40;
  var SCORE_MULTIPLIER          = 7;
  var MAX_MOMENTUM_CONTRIBUTION = 45;
  var MOMENTUM_PTS_PER_HEADLINE = 15;
  var NEAR_EVENT_PENALTY        = 0.6;

  function computeConfidence(score, momentumCount, nearEvent) {
    var absScore = Math.abs(score);
    var scorePct = Math.min(MAX_SCORE_CONTRIBUTION, absScore * SCORE_MULTIPLIER);
    var momPct   = Math.min(MAX_MOMENTUM_CONTRIBUTION, (momentumCount - 1) * MOMENTUM_PTS_PER_HEADLINE);
    var raw      = BASE_CONFIDENCE + scorePct + momPct;
    return nearEvent ? Math.max(0, Math.round(raw * NEAR_EVENT_PENALTY)) : Math.round(Math.min(raw, 100));
  }

  // ── Main Processor ───────────────────────────────────────────────────────────
  function processHeadlines(headlines, currentPrice, isNearEvent) {
    var signals = [];
    var now     = Date.now();

    headlines.forEach(function (h) {
      if (!h || !h.title) return;
      var result = scoreHeadline(h.title);
      var cls    = classifySignal(result.score);
      if (cls.dir === 'NEUTRAL') return;

      pushMomentum(now, result.score, cls.dir, h.title);
      var mom = getMomentum(cls.dir);

      var levels = computeTPSL(cls.dir, cls.strength, currentPrice);
      if (!levels) return;

      var conf = computeConfidence(result.score, mom.length, isNearEvent);
      signals.push({
        id:         now + '_' + Math.random().toString(36).slice(2, 8),
        ts:         now,
        label:      cls.label,
        dir:        cls.dir,
        strength:   cls.strength,
        entry:      levels.entry,
        tp:         levels.tp,
        sl:         levels.sl,
        tpPips:     levels.tpPips,
        slPips:     levels.slPips,
        rr:         levels.rr,
        confidence: conf,
        headline:   h.title,
        source:     h.source || '',
        nearEvent:  !!isNearEvent,
        matched:    result.matched,
        outcome:    'pending',
      });
    });

    if (!signals.length) return null;
    // Return highest-confidence signal
    signals.sort(function (a, b) { return b.confidence - a.confidence; });
    return signals[0];
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  global.SignalEngine = {
    scoreHeadline:    scoreHeadline,
    classifySignal:   classifySignal,
    computeTPSL:      computeTPSL,
    processHeadlines: processHeadlines,
    computeConfidence: computeConfidence,
  };

}(window));
