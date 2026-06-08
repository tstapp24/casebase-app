'use strict';

// Chart.js-based price history chart for the skin detail modal.
// This file is loaded by app.js after Chart is available.

let priceChartInstance = null;

function destroyPriceChart() {
  if (priceChartInstance) {
    priceChartInstance.destroy();
    priceChartInstance = null;
  }
}

function renderPriceChart(canvasId, history) {
  destroyPriceChart();

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const chartEmpty = document.getElementById('chart-empty');

  if (!history || history.length === 0) {
    canvas.style.display = 'none';
    if (chartEmpty) chartEmpty.style.display = 'block';
    return;
  }

  canvas.style.display = 'block';
  if (chartEmpty) chartEmpty.style.display = 'none';

  const labels = history.map(h => {
    const d = new Date(h.recorded_at * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  });

  const prices = history.map(h => h.price_usd);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pad = (maxPrice - minPrice) * 0.1 || 1;

  const ctx = canvas.getContext('2d');

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 220);
  gradient.addColorStop(0, 'rgba(0, 255, 135, 0.25)');
  gradient.addColorStop(1, 'rgba(0, 255, 135, 0.0)');

  priceChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Price (USD)',
        data: prices,
        borderColor: '#00ff87',
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: history.length > 30 ? 0 : 3,
        pointBackgroundColor: '#00ff87',
        pointHoverRadius: 5,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#12121f',
          borderColor: '#1e1e38',
          borderWidth: 1,
          titleColor: '#7878a0',
          bodyColor: '#e8e8f0',
          callbacks: {
            label: (ctx) => ` $${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(30, 30, 56, 0.8)', drawBorder: false },
          ticks: {
            color: '#4a4a6a',
            font: { size: 10 },
            maxTicksLimit: 8,
            maxRotation: 0,
          },
        },
        y: {
          min: Math.max(0, minPrice - pad),
          max: maxPrice + pad,
          grid: { color: 'rgba(30, 30, 56, 0.8)', drawBorder: false },
          ticks: {
            color: '#4a4a6a',
            font: { size: 10 },
            callback: (v) => `$${v.toFixed(2)}`,
          },
        },
      },
    },
  });
}

// Attach to window so app.js can use it
window.renderPriceChart = renderPriceChart;
window.destroyPriceChart = destroyPriceChart;

// ── Portfolio chart ───────────────────────────────────────────────────────────

let portfolioChartInstance = null;

function destroyPortfolioChart() {
  if (portfolioChartInstance) {
    portfolioChartInstance.destroy();
    portfolioChartInstance = null;
  }
}

function renderPortfolioChart(canvasId, history) {
  destroyPortfolioChart();

  const canvas = document.getElementById(canvasId);
  const empty = document.getElementById('portfolio-chart-empty');
  if (!canvas) return;

  if (!history || history.length < 2) {
    canvas.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }

  canvas.style.display = 'block';
  if (empty) empty.style.display = 'none';

  const values = history.map(h => h.total_value);
  const firstVal = values[0];
  const lastVal = values[values.length - 1];
  const isUp = lastVal >= firstVal;

  const lineColor = isUp ? '#00ff87' : '#ff4f4f';
  const gradientTop = isUp ? 'rgba(0, 255, 135, 0.20)' : 'rgba(255, 79, 79, 0.20)';
  const gradientBot = isUp ? 'rgba(0, 255, 135, 0.0)' : 'rgba(255, 79, 79, 0.0)';

  const labels = history.map(h => {
    const d = new Date(h.recorded_at * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  });

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = (maxVal - minVal) * 0.12 || 5;

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 300);
  gradient.addColorStop(0, gradientTop);
  gradient.addColorStop(1, gradientBot);

  portfolioChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Portfolio Value',
        data: values,
        borderColor: lineColor,
        backgroundColor: gradient,
        borderWidth: 2.5,
        pointRadius: history.length > 40 ? 0 : 4,
        pointBackgroundColor: lineColor,
        pointHoverRadius: 6,
        tension: 0.35,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#12121f',
          borderColor: '#1e1e38',
          borderWidth: 1,
          titleColor: '#7878a0',
          bodyColor: '#e8e8f0',
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed.y;
              const diff = val - firstVal;
              const pct = firstVal > 0 ? ((diff / firstVal) * 100).toFixed(1) : '0.0';
              const sign = diff >= 0 ? '+' : '';
              return [` Value: $${val.toFixed(2)}`, ` Change: ${sign}$${diff.toFixed(2)} (${sign}${pct}%)`];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(30, 30, 56, 0.8)', drawBorder: false },
          ticks: {
            color: '#4a4a6a',
            font: { size: 10 },
            maxTicksLimit: 10,
            maxRotation: 0,
          },
        },
        y: {
          min: Math.max(0, minVal - pad),
          max: maxVal + pad,
          grid: { color: 'rgba(30, 30, 56, 0.8)', drawBorder: false },
          ticks: {
            color: '#4a4a6a',
            font: { size: 11 },
            callback: (v) => `$${v.toFixed(0)}`,
          },
        },
      },
    },
  });
}

window.renderPortfolioChart = renderPortfolioChart;
window.destroyPortfolioChart = destroyPortfolioChart;
