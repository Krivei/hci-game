"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";
import { useTranslation } from 'react-i18next';
import i18next from "./i18n/client"

const MAX_ROUNDS = 20;

/** Helpers */
function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function hslToRgb(h: number, s: number, l: number) {
  // h: 0-360, s/l: 0-100 -> returns {r,g,b} 0-255
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4)),
  };
}

function rgbToLuminance(rgb: { r: number; g: number; b: number }) {
  const srgb = [rgb.r, rgb.g, rgb.b].map((v) => v / 255).map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  // Rec. 709 / WCAG
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function hslToCss(h: number, s: number, l: number) {
  return `hsl(${h} ${s}% ${l}%)`;
}

type Option = { css: string; lum: number; lightness: number };
type RoundData = {
  options: Option[];
  correctIndex: number;
  lumGap: number; // between top two
  hue: number;
  sat: number;
};

// TARGET for the final round: luminance gap that is "barely different" to the eye.
// Chosen default is 0.02 (≈2% Weber fraction) which is a common perceptual threshold.
const FINAL_ROUND_TARGET_GAP = 0.02;

function lumForHsl(hue: number, sat: number, l: number) {
  const rgb = hslToRgb(hue, sat, l);
  return rgbToLuminance(rgb);
}

/**
 * Try to find two lightness values (l1,l2) for given hue/sat where |lum(l1)-lum(l2)| ≈ targetGap.
 * We'll fix l1 = baseL and search for l2 by binary search up and down.
 * Returns null if not found within attempts.
 */
function findMatchForTargetGap(hue: number, sat: number, baseL: number, targetGap: number, tol = 5e-4) {
  const lum1 = lumForHsl(hue, sat, baseL);
  // search upward (l2 > baseL)
  let found: number | null = null;
  // only search upward if there's room
  const hi = 94;
  if (baseL < hi) {
    let l2lo = baseL;
    let l2hi = hi;
    for (let i = 0; i < 40; i++) {
      const mid = (l2lo + l2hi) / 2;
      const lum2 = lumForHsl(hue, sat, mid);
      const diff = Math.abs(lum2 - lum1);
      if (Math.abs(diff - targetGap) <= tol) {
        found = mid;
        break;
      }
      if (diff > targetGap) {
        l2hi = mid;
      } else {
        l2lo = mid;
      }
    }
  }
  // if not found upward, try downward
  if (found === null && baseL > 6) {
    let l2lo = 6;
    let l2hi = baseL;
    for (let i = 0; i < 40; i++) {
      const mid = (l2lo + l2hi) / 2;
      const lum2 = lumForHsl(hue, sat, mid);
      const diff = Math.abs(lum2 - lum1);
      if (Math.abs(diff - targetGap) <= tol) {
        found = mid;
        break;
      }
      if (diff > targetGap) {
        l2lo = mid;
      } else {
        l2hi = mid;
      }
    }
  }
  return found;
}

/**
 * Attempt several random hue/base combinations to find a pair with luminance gap ≈ targetGap.
 */
function generatePairWithTargetGap(optionsCount: number, targetGap: number): RoundData | null {
  // we only support 2 options here
  if (optionsCount < 2) return null;
  for (let attempt = 0; attempt < 100; attempt++) {
  const hue = Math.floor(rand(0, 360));
  const sat = Math.floor(rand(60, 88));
  // broaden base range so we can reach large luminance gaps (near-extremes)
  const base = Math.floor(rand(10, 90));
  const match = findMatchForTargetGap(hue, sat, base, targetGap, 1e-4);
    if (match != null) {
      const l1 = base;
      const l2 = match;
      const options: Option[] = [
        { css: hslToCss(hue, sat, l1), lum: lumForHsl(hue, sat, l1), lightness: l1 },
        { css: hslToCss(hue, sat, l2), lum: lumForHsl(hue, sat, l2), lightness: l2 },
      ];
      // shuffle
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = options[i];
        options[i] = options[j];
        options[j] = tmp;
      }
      const lumArray = options.map((o) => o.lum);
      const sorted = [...lumArray].slice().sort((a, b) => b - a);
      const correctLum = sorted[0];
      const secondLum = sorted[1] ?? sorted[0];
      const correctIndex = options.findIndex((o) => o.lum === correctLum);
      return { options, correctIndex, lumGap: Math.abs(correctLum - secondLum), hue, sat };
    }
  }
  return null;
}

function targetGapForRound(r: number) {
  // Use geometric (exponential) interpolation so the gap shrinks faster and becomes
  // perceptually harder earlier. This yields a multiplicative decrease from first->last.
  const first = 0.8;
  const last = 0.002;
  const steps = Math.max(1, MAX_ROUNDS - 1);
  const t = (r - 1) / steps; // 0..1
  const ratio = last / first;
  return first * Math.pow(ratio, t);
}
/** Generate N options stacked vertically. difficulty controls the step between lightnesses (smaller = harder) */
function generateOptions(count: number, step: number): RoundData {
  const hue = Math.floor(rand(0, 360));
  const sat = Math.floor(rand(60, 88));
  const base = Math.floor(rand(30, 60));

  // Build lightness offsets centered around base. e.g., for count=3 and step=4 -> [-4,0,4]
  const mid = (count - 1) / 2;
  const offsets = Array.from({ length: count }, (_, i) => (i - mid) * step);

  const lightnesses = offsets.map((off) => Math.max(6, Math.min(94, base + off)));

  const options = lightnesses.map((l) => {
    const rgb = hslToRgb(hue, sat, l);
    return { css: hslToCss(hue, sat, l), lum: rgbToLuminance(rgb), lightness: l };
  });

  // Compute luminance stats (before shuffling)
  const lumArray = options.map((o) => o.lum);
  const sorted = [...lumArray].slice().sort((a, b) => b - a);
  const correctLum = sorted[0];
  const secondLum = sorted[1] ?? sorted[0];

  // Shuffle options so correct answer isn't always in the same position
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = options[i];
    options[i] = options[j];
    options[j] = tmp;
  }

  // Find the index of the correct (lightest) option after shuffling
  const correctIndex = options.findIndex((o) => o.lum === correctLum);

  return { options, correctIndex, lumGap: Math.abs(correctLum - secondLum), hue, sat };
}

const LanguageSwitcher: React.FC = () => {
  return (
    <div className="ls-container">
      <div className={`ls-lb${i18next.language === "en" ? " active" : ""}`} onClick={() => i18next.changeLanguage("en")}>EN</div>
      <div className={`ls-lb${i18next.language === "de" ? " active" : ""}`} onClick={() => i18next.changeLanguage("de")}>DE</div>
      <div className={`ls-lb${i18next.language === "cn" ? " active" : ""}`} onClick={() => i18next.changeLanguage("cn")}>中文</div>
    </div>
  );
};

export default function Page() {
  // game states: idle (tap to start), countdown, playing, gameover
  const [state, setState] = useState<"idle" | "countdown" | "playing" | "gameover">("idle");
  const [countdown, setCountdown] = useState(5);

  const [round, setRound] = useState(0);
  const [roundData, setRoundData] = useState<RoundData | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const [score, setScore] = useState(0);

  // timing/avg
  const roundStartRef = useRef<number | null>(null);
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const [totalTimeMs, setTotalTimeMs] = useState(0);
  const [roundTime, setRoundTime] = useState<number[]>([]);
  // Session/timing state for export
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [sessionEnd, setSessionEnd] = useState<number | null>(null);

  // Logging: store per-round results (still kept for debugging) but not required for export
  type LogEntry = {
    round: number;
    selectedIndex: number;
    correctIndex: number;
    correct: boolean;
    lumGap: number;
    timeMs: number;
    hue: number | null;
    sat: number | null;
    optionLightnesses: number[];
  };
  const [log, setLog] = useState<LogEntry[]>([]);

  // translation
  const { t } = useTranslation()

  // difficulty progression params
  const maxOptions = 5;
  const initialStep = 6; // larger step = easier
  const minStep = 0.7; // smallest step = hardest

  // compute dynamic difficulty based on round number
  function difficultyForRound(r: number) {
    // always 2 options per user request
    const options = 2;
    // decrease step gradually to increase difficulty
    const step = Math.max(minStep, initialStep - r * 0.25);
    return { options, step };
  }

  // start a new round (internal)
  function startRound(r: number) {
    const { options, step } = difficultyForRound(r - 1);

    // Compute target gap for this round (linearly decreasing from 1 to 0.002)
    const targetGap = targetGapForRound(r);

    // Special-case: if targetGap is near 1.0, produce pure black / white pair for clarity
    if (targetGap >= 0.99) {
      const hue = Math.floor(rand(0, 360));
      const sat = Math.floor(rand(60, 88));
      const opts: Option[] = [
        { css: hslToCss(hue, sat, 0), lum: rgbToLuminance(hslToRgb(hue, sat, 0)), lightness: 0 },
        { css: hslToCss(hue, sat, 100), lum: rgbToLuminance(hslToRgb(hue, sat, 100)), lightness: 100 },
      ];
      // shuffle
      if (Math.random() < 0.5) opts.reverse();
      const lumArray = opts.map((o) => o.lum);
      const sorted = [...lumArray].slice().sort((a, b) => b - a);
      const correctLum = sorted[0];
      const secondLum = sorted[1] ?? sorted[0];
      const correctIndex = opts.findIndex((o) => o.lum === correctLum);
      setRoundData({ options: opts, correctIndex, lumGap: Math.abs(correctLum - secondLum), hue, sat });
    } else {
      // Attempt to generate an actual pair matching the target gap
      const pair = generatePairWithTargetGap(options, targetGap);
      if (pair) {
        setRoundData(pair);
      } else {
        // fallback: use normal generator with step, but override lumGap display to targetGap when possible
    const data = generateOptions(options, Math.max(step, 0.8));
    // do NOT override the measured lumGap — show the actual computed gap so debug matches what is rendered
    setRoundData(data);
      }
    }
    roundStartRef.current = Date.now();
    setLastResult(null);
  }

  // start game after countdown
  useEffect(() => {
    let t: number | undefined;
    if (state === "countdown") {
      if (countdown <= 0) {
        setState("playing");
        setRound(1);
        setRoundsCompleted(0);
        setTotalTimeMs(0);
        startRound(1);
      } else {
        t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
      }
    }
    return () => {
      if (t) clearTimeout(t);
    };
  }, [state, countdown]);

  // when entering playing and round changes, ensure round data exists
  useEffect(() => {
    if (state === "playing" && round > 0) {
      startRound(round);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, round]);

  function handleTapToStart() {
    // start immediately (no countdown)
    setCountdown(5);
    setState("playing");
    setRound(1);
    setRoundsCompleted(0);
    setTotalTimeMs(0);
    startRound(1);
    setScore(0);
    setRoundTime([]);
    setLog([]);
    setSessionStart(Date.now());
    setSessionEnd(null);
  }

  function handleChoose(index: number) {
    if (!roundData || state !== "playing") return;
    const now = Date.now();
    const start = roundStartRef.current ?? now;
    const timeMs = now - start;
    const correct = index === roundData.correctIndex;

    // always count the round for average/time
    setRoundsCompleted((n) => n + 1);
    setTotalTimeMs((t) => t + timeMs);
    setRoundTime((rt) => [...rt, timeMs]);

    // append log entry for this round
    setLog((prev) => [
      ...prev,
      {
        round,
        selectedIndex: index,
        correctIndex: roundData.correctIndex,
        correct,
        lumGap: roundData.lumGap,
        timeMs,
        hue: roundData.hue ?? null,
        sat: roundData.sat ?? null,
        optionLightnesses: roundData.options.map((o) => o.lightness),
      },
    ]);

    if (!correct) {
      // show brief wrong feedback
      setLastResult("Wrong");
    } else {
      setScore((s) => s + 1);
      // clear any previous message for correct
      setLastResult(null);
    }

    // advance to next round or finish after 20 rounds
    if (round >= MAX_ROUNDS) {
      // game finished
      setSessionEnd(Date.now());
      setState("gameover");
      roundStartRef.current = null;
    } else {
      setRound((r) => r + 1);
    }
  }

  const averageMs = roundsCompleted > 0 ? totalTimeMs / roundsCompleted : 0;

  // When the game ends, automatically download the log as CSV
  useEffect(() => {
  // Export only the minimal summary CSV the user requested:
  // correctCount, average reaction time (ms), total gameplay duration (ms)
  if (state !== "gameover") return;

  const totalMs = totalTimeMs;
  const averageMs = roundsCompleted > 0 ? totalTimeMs / roundsCompleted : 0;
  const correctCount = score;

  const header = ["correctCount", "averageMs", "totalTimeMs"];
  const row = [String(correctCount), averageMs.toFixed(3), String(totalMs)];
  const csv = [header.join(","), row.join(",")].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:\.]/g, "-");
    a.href = url;
    a.download = `hci-game-summary-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [state, totalTimeMs, roundsCompleted, score]);

  return (
    <main style={{ padding: 20, fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>{t("h1.pickTheLighterColour")}</h1>
          <div>
            <LanguageSwitcher />
          </div>
        </div>

      {state === "idle" && (
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <button
            onClick={handleTapToStart}
            style={{ fontSize: 20, padding: "14px 24px", borderRadius: 12, cursor: "pointer" }}>
            {t("button.tapToStart")}
          </button>
        </div>
      )}

      {state === "countdown" && (
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <div style={{ fontSize: 48, fontWeight: 700 }}>{countdown}</div>
          <div style={{ color: "#666", marginTop: 8 }}>{t("label.getReady")}</div>
        </div>
      )}

      {state === "gameover" && (
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{t("label.gameOver")}</div>
          <div style={{ color: "#333", marginTop: 8, fontSize: 16 }}>
            {t("label.finalScore")}: {score}
          </div>
          <div style={{ color: "#666", marginTop: 6 }}>
            {t("label.avgTime")}: {averageMs ? `${(averageMs / 1000).toFixed(2)}s` : "—"}
          </div>
          <button
            onClick={() => handleTapToStart()}
            style={{ marginTop: 14, fontSize: 16, padding: "10px 18px", borderRadius: 10, cursor: "pointer" }}>
            {t("button.tapToPlayAgain")}
          </button>
        </div>
      )}

      {state === "playing" && roundData && (
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
            <div>
              <strong>{t("label.round")}: {round} / {MAX_ROUNDS}</strong>
            </div>
            <div style={{ textAlign: "right", color: "#666", fontSize: 13 }}>
              {t("label.avgTime")}: {averageMs ? `${(averageMs / 1000).toFixed(2)}s` : "—"}
              <div style={{ fontSize: 11 }}>{t("label.score")}: {score}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {roundData.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleChoose(i)}
                aria-label={`Option ${i + 1}`}
                style={{
                  width: "100%",
                  height: 220,
                  borderRadius: 12,
                  border: "2px solid #111",
                  background: opt.css,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            {lastResult && <div style={{ marginBottom: 8 }}>{lastResult}</div>}
            <div style={{ color: "#666", fontSize: 13 }}>{t("label.luminanceGap")}: { roundData.lumGap.toFixed(4) }</div>
          </div>
        </section>
      )}
      </div>
    </main>
  );
}