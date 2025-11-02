"use client";

import React, { useEffect, useRef, useState } from "react";

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

export default function Page() {
  // game states: idle (tap to start), countdown, playing, gameover
  const [state, setState] = useState<"idle" | "countdown" | "playing" | "gameover">("idle");
  const [countdown, setCountdown] = useState(5);

  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [roundData, setRoundData] = useState<RoundData | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // timing/avg
  const roundStartRef = useRef<number | null>(null);
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const [totalTimeMs, setTotalTimeMs] = useState(0);

  // difficulty progression params
  const maxOptions = 5;
  const initialStep = 6; // larger step = easier
  const minStep = 0.7; // smallest step = hardest

  // compute dynamic difficulty based on round number
  function difficultyForRound(r: number) {
    // increase options every 6 rounds
    const options = Math.min(maxOptions, 2 + Math.floor(r / 6));
    // decrease step gradually
    const step = Math.max(minStep, initialStep - r * 0.25);
    return { options, step };
  }

  // start a new round (internal)
  function startRound(r: number) {
    const { options, step } = difficultyForRound(r - 1);
    const data = generateOptions(options, step);
    setRoundData(data);
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
        setScore(0);
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
    setCountdown(5);
    setState("countdown");
  }

  function handleChoose(index: number) {
    if (!roundData || state !== "playing") return;
    const now = Date.now();
    const start = roundStartRef.current ?? now;
    const timeMs = now - start;

    const correct = index === roundData.correctIndex;
    if (correct) {
      setLastResult("Correct");
      setScore((s) => s + 1);
      // update timing only for successful rounds
      setRoundsCompleted((n) => n + 1);
      setTotalTimeMs((t) => t + timeMs);

      // brief delay then next round
      setTimeout(() => {
        setRound((r) => r + 1);
      }, 600);
    } else {
      setLastResult("Wrong");
      // end the game immediately
      setState("gameover");
      // stop timer reference
      roundStartRef.current = null;
    }
  }

  const averageMs = roundsCompleted > 0 ? totalTimeMs / roundsCompleted : 0;

  return (
    <main style={{ padding: 20, fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 6 }}>Pick the lighter color</h1>

      {state === "idle" && (
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <button
            onClick={handleTapToStart}
            style={{ fontSize: 20, padding: "14px 24px", borderRadius: 12, cursor: "pointer" }}>
            Tap to start
          </button>
          <p style={{ color: "#666", marginTop: 12 }}>Game will begin after a 5 second countdown.</p>
        </div>
      )}

      {state === "countdown" && (
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <div style={{ fontSize: 48, fontWeight: 700 }}>{countdown}</div>
          <div style={{ color: "#666", marginTop: 8 }}>Get ready...</div>
        </div>
      )}

      {state === "gameover" && (
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>Game over</div>
          <div style={{ color: "#333", marginTop: 8, fontSize: 16 }}>
            Final score: <strong>{score}</strong>
          </div>
          <div style={{ color: "#666", marginTop: 6 }}>Avg time: {averageMs ? `${(averageMs / 1000).toFixed(2)}s` : "—"}</div>
          <button
            onClick={() => {
              // reset to idle so user can tap to start again
              setState("idle");
              setCountdown(5);
              setRound(0);
              setRoundData(null);
              setLastResult(null);
              setRoundsCompleted(0);
              setTotalTimeMs(0);
              setScore(0);
            }}
            style={{ marginTop: 14, fontSize: 16, padding: "10px 18px", borderRadius: 10, cursor: "pointer" }}>
            Tap to play again
          </button>
        </div>
      )}

      {state === "playing" && roundData && (
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <strong>Round:</strong> {round} &nbsp; <strong>Score:</strong> {score}
            </div>
            <div style={{ textAlign: "right", color: "#666", fontSize: 13 }}>
              Avg time: {averageMs ? `${(averageMs / 1000).toFixed(2)}s` : "—"}
              <div style={{ fontSize: 11 }}>Rounds: {roundsCompleted}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {roundData.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleChoose(i)}
                aria-label={`Option ${i + 1}`}
                style={{
                  width: "100%",
                  height: 84,
                  borderRadius: 10,
                  border: "2px solid #111",
                  background: opt.css,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            {lastResult && <div style={{ marginBottom: 8 }}>{lastResult}</div>}
            <div style={{ color: "#666", fontSize: 13 }}>Luminance gap (debug): {roundData.lumGap.toFixed(4)}</div>
          </div>
        </section>
      )}
    </main>
  );
}