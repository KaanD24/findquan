"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const POPULAR = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B"];

export default function Home() {
  const router = useRouter();
  const [ticker, setTicker] = useState("");

  function go(sym: string) {
    const s = sym.trim().toUpperCase();
    if (s) router.push(`/stock?ticker=${encodeURIComponent(s)}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    go(ticker);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-4">
      {/* Hero */}
      <div className="text-center mb-12 max-w-2xl">
        <div className="inline-flex items-center gap-2 bg-emerald-950/60 border border-emerald-800/50 rounded-full px-4 py-1.5 text-emerald-400 text-xs font-medium mb-6 tracking-wide">
          ● LIVE DATA FROM SEC EDGAR & YAHOO FINANCE
        </div>
        <h1 className="text-5xl font-bold text-white tracking-tight mb-4 leading-tight">
          Find<span className="text-emerald-400">Quan</span>
        </h1>
        <p className="text-lg text-zinc-400 leading-relaxed">
          Institutional-grade financial analysis for long-term investors.<br />
          Revenue trends, earnings growth, valuation zones, and dilution alerts.
        </p>
      </div>

      {/* Search */}
      <form onSubmit={handleSubmit} className="w-full max-w-lg mb-8">
        <div className="flex gap-2">
          <input
            autoFocus
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="Enter ticker (AAPL, MSFT, GOOGL…)"
            className="flex-1 bg-zinc-900 text-white text-base rounded-xl px-4 py-3.5 border border-zinc-700 focus:outline-none focus:border-emerald-500 placeholder:text-zinc-600 uppercase placeholder:normal-case tracking-widest"
          />
          <button
            type="submit"
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl px-6 py-3.5 transition-colors text-sm"
          >
            Analyze →
          </button>
        </div>
      </form>

      {/* Popular tickers */}
      <div className="flex flex-wrap justify-center gap-2 mb-16">
        <span className="text-zinc-600 text-xs self-center mr-1">Popular:</span>
        {POPULAR.map((s) => (
          <button
            key={s}
            onClick={() => go(s)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-600 transition-all font-mono"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl w-full text-center">
        {[
          { icon: "📈", label: "Revenue & Earnings CAGR" },
          { icon: "🎯", label: "Valuation Zone" },
          { icon: "⚠️", label: "Dilution Alerts" },
          { icon: "📊", label: "7 Interactive Charts" },
        ].map(({ icon, label }) => (
          <div key={label} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
            <div className="text-2xl mb-2">{icon}</div>
            <div className="text-xs text-zinc-400">{label}</div>
          </div>
        ))}
      </div>

      <p className="mt-12 text-zinc-700 text-xs">
        Data sourced from SEC EDGAR and Yahoo Finance. Not financial advice.
      </p>
    </div>
  );
}
