import { OpenAPIHono } from "@hono/zod-openapi";

// Serves a minimal TradingView-like UI backed by our /tv endpoints.
// Query params: symbol (default INDEX:FAMC), resolution (default 60), bars (default 500)
export const appUi = new OpenAPIHono();

appUi.get("/ui", async (c) => {
  const url = new URL(c.req.url);
  const symbol = (url.searchParams.get("symbol") || "INDEX:FAMC").toUpperCase();
  const resolution = (url.searchParams.get("resolution") || "60").toUpperCase();
  const bars = Number(url.searchParams.get("bars") || 500);

  // Inline HTML page using Lightweight Charts from CDN
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chart - ${symbol} (${resolution})</title>
  <style>
    html, body { height: 100%; margin: 0; background: #0b0e11; color: #eaecef; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'; }
    .container { display: flex; flex-direction: column; height: 100%; }
    header { padding: 12px 16px; display: flex; gap: 12px; align-items: center; border-bottom: 1px solid #1f2326; }
    header input, header select { background: #12161c; border: 1px solid #1f2326; color: #eaecef; padding: 6px 8px; border-radius: 6px; }
    header button { background: #1a73e8; border: none; color: white; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
    header button:disabled { opacity: 0.6; cursor: default; }
    #chart { flex: 1 1 auto; }
    footer { padding: 8px 16px; font-size: 12px; color: #9aa4ad; border-top: 1px solid #1f2326; }
    a { color: #8ab4f8; text-decoration: none; }
  </style>
  <script src="https://unpkg.com/lightweight-charts@4.2.2/dist/lightweight-charts.standalone.production.js"></script>
  <script>
    // Small utility to read/modify URL params
    function updateQuery(params) {
      const url = new URL(window.location.href);
      Object.keys(params).forEach((k) => {
        if (params[k] === undefined || params[k] === null) return;
        url.searchParams.set(k, String(params[k]));
      });
      window.history.replaceState({}, '', url.toString());
    }

    async function fetchNowSec() {
      const res = await fetch('/tv/time');
      const txt = await res.text();
      return Number(txt);
    }

    function secondsPerBar(resolution) {
      if (resolution === 'D') return 86400;
      const n = Number(resolution);
      if (!Number.isFinite(n) || n <= 0) return 60;
      return n * 60;
    }

    async function fetchSeries(symbol, resolution, bars) {
      const now = await fetchNowSec();
      const spb = secondsPerBar(resolution);
      const from = Math.max(0, Math.floor(now - bars * spb));
      const to = now;
      const qs = new URLSearchParams({ symbol, resolution, from: String(from), to: String(to) });
      const res = await fetch('/tv/history?' + qs.toString());
      const data = await res.json();
      if (data.s !== 'ok') return [];
      // Convert to line series format { time: unix, value: c }
      const out = [];
      for (let i = 0; i < data.t.length; i++) {
        out.push({ time: data.t[i], value: data.c[i] });
      }
      return out;
    }

    async function main() {
      const initialSymbol = '${symbol}';
      const initialResolution = '${resolution}';
      const initialBars = ${bars};

      // Controls
      const symbolInput = document.getElementById('symbol');
      const resSelect = document.getElementById('resolution');
      const barsInput = document.getElementById('bars');
      const reloadBtn = document.getElementById('reload');

      symbolInput.value = initialSymbol;
      resSelect.value = initialResolution;
      barsInput.value = String(initialBars);

      const container = document.getElementById('chart');
      const chart = LightweightCharts.createChart(container, {
        layout: { background: { type: 'solid', color: '#0b0e11' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1f2326' }, horzLines: { color: '#1f2326' } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true },
        crosshair: { mode: 0 },
        localization: { locale: 'en-US' },
      });
      const lineSeries = chart.addLineSeries({ color: '#1a73e8', lineWidth: 2 });

      async function load() {
        reloadBtn.disabled = true;
        const s = symbolInput.value.trim().toUpperCase() || 'INDEX:FAMC';
        const r = resSelect.value.trim().toUpperCase() || '60';
        const b = Math.max(50, Math.min(5000, Number(barsInput.value) || 500));
        updateQuery({ symbol: s, resolution: r, bars: b });
        const series = await fetchSeries(s, r, b);
        lineSeries.setData(series);
        reloadBtn.disabled = false;
      }

      // Initial load
      await load();

      // Wire UI
      reloadBtn.addEventListener('click', load);

      // Resize handling
      const resize = () => {
        const rect = container.getBoundingClientRect();
        chart.applyOptions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      };
      new ResizeObserver(resize).observe(container);
      window.addEventListener('orientationchange', resize);
      setTimeout(resize, 0);
    }

    window.addEventListener('DOMContentLoaded', main);
  </script>
</head>
<body>
  <div class="container">
    <header>
      <label>Symbol <input id="symbol" placeholder="INDEX:FAMC" /></label>
      <label>Resolution
        <select id="resolution">
          <option value="1">1</option>
          <option value="5">5</option>
          <option value="15">15</option>
          <option value="60">60</option>
          <option value="240">240</option>
          <option value="D">D</option>
        </select>
      </label>
      <label>Bars <input id="bars" type="number" min="50" max="5000" step="50" /></label>
      <button id="reload">Reload</button>
      <div style="flex:1"></div>
      <div style="opacity:.8">Data via <code>/tv</code> endpoints</div>
    </header>
    <div id="chart"></div>
    <footer>
      Rendering with <a href="https://github.com/tradingview/lightweight-charts" target="_blank" rel="noreferrer">Lightweight Charts</a>.
    </footer>
  </div>
</body>
</html>`;

  return c.html(html);
});


