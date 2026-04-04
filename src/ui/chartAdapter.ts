// Module responsibility: encapsulate lightweight-charts usage for the observability UI.

(function registerChartAdapter(globalScope) {
  const MAX_VISIBLE_MARKER_TEXT = 6;

  function createSeries(chart, seriesType, options) {
    if (typeof chart.addSeries === "function" && globalScope.LightweightCharts?.[seriesType]) {
      return chart.addSeries(globalScope.LightweightCharts[seriesType], options);
    }
    if (seriesType === "LineSeries" && typeof chart.addLineSeries === "function") {
      return chart.addLineSeries(options);
    }
    if (seriesType === "CandlestickSeries" && typeof chart.addCandlestickSeries === "function") {
      return chart.addCandlestickSeries(options);
    }
    throw new Error(`Unsupported series type: ${seriesType}`);
  }

  function setMarkers(series, markers, markerHandleRef) {
    if (typeof globalScope.LightweightCharts?.createSeriesMarkers === "function") {
      if (!markerHandleRef.current) {
        markerHandleRef.current = globalScope.LightweightCharts.createSeriesMarkers(series, markers);
      } else if (typeof markerHandleRef.current.setMarkers === "function") {
        markerHandleRef.current.setMarkers(markers);
      }
      return;
    }
    if (typeof series.setMarkers === "function") {
      series.setMarkers(markers);
    }
  }

  function normalizeEpochSeconds(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
    if (numericValue > 1_000_000_000_000) {
      return Math.floor(numericValue / 1000);
    }
    return Math.floor(numericValue);
  }

  function findFloorTime(times, targetTime) {
    if (!Array.isArray(times) || times.length <= 0) return null;
    let low = 0;
    let high = times.length - 1;
    let best = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = times[mid];
      if (candidate === targetTime) {
        return candidate;
      }
      if (candidate < targetTime) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  function projectMarkers(markers, referenceData) {
    if (!Array.isArray(markers) || markers.length <= 0 || !Array.isArray(referenceData) || referenceData.length <= 0) {
      return [];
    }

    const seriesTimes = referenceData
      .map((point) => normalizeEpochSeconds(point?.time))
      .filter((time) => time !== null);
    if (seriesTimes.length <= 0) {
      return [];
    }

    const minTime = seriesTimes[0];
    const maxTime = seriesTimes[seriesTimes.length - 1];
    const projected = [];
    const seen = new Set();

    for (const marker of markers) {
      const rawTime = normalizeEpochSeconds(marker?.time ?? marker?.timestamp);
      if (rawTime === null || rawTime < minTime || rawTime > maxTime) {
        continue;
      }

      const alignedTime = findFloorTime(seriesTimes, rawTime);
      if (alignedTime === null || alignedTime < minTime || alignedTime > maxTime) {
        continue;
      }

      const normalizedMarker = {
        color: marker?.color,
        position: marker?.position,
        shape: marker?.shape,
        text: typeof marker?.text === "string" ? marker.text : "",
        time: alignedTime
      };
      const dedupeKey = [
        normalizedMarker.time,
        normalizedMarker.position,
        normalizedMarker.shape,
        normalizedMarker.color,
        normalizedMarker.text
      ].join("|");
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      projected.push(normalizedMarker);
    }

    projected.sort((left, right) => Number(left.time) - Number(right.time));
    const textStartIndex = Math.max(0, projected.length - MAX_VISIBLE_MARKER_TEXT);
    return projected.map((marker, index) => ({
      ...marker,
      text: index >= textStartIndex ? marker.text : ""
    }));
  }

  function createChartAdapter(options) {
    const container = options.container;
    const legendNode = options.legendNode || null;
    const titleNode = options.titleNode || null;

    let chart = null;
    let lineSeries = null;
    let candleSeries = null;
    let resizeObserver = null;
    let lineMarkers = { current: null };
    let candleMarkers = { current: null };
    let currentSymbol = null;
    let currentTimeframe = "1m";
    let currentMode = "line";
    let lastLineTime = null;
    let lastCandleTime = null;
    let priceLines = [];
    let didFitContent = false;
    let warnedInvalidSize = false;
    let currentContextKey = null;

    function getContainerSize() {
      const width = Math.floor(container?.clientWidth || 0);
      const height = Math.floor(container?.clientHeight || 0);
      return { height, width };
    }

    function ensureChart() {
      if (chart) return true;
      const size = getContainerSize();
      if (size.width <= 0 || size.height <= 0) {
        if (!warnedInvalidSize) {
          warnedInvalidSize = true;
          console.warn("ChartAdapter: invalid container size, delaying init", size);
        }
        return false;
      }

      warnedInvalidSize = false;
      chart = globalScope.LightweightCharts.createChart(container, {
        crosshair: {
          mode: globalScope.LightweightCharts.CrosshairMode?.Normal ?? 1
        },
        grid: {
          horzLines: {
            color: "rgba(148, 163, 184, 0.12)"
          },
          vertLines: {
            color: "rgba(148, 163, 184, 0.08)"
          }
        },
        layout: {
          background: {
            color: "#10192d",
            type: "solid"
          },
          textColor: "#dbe6f5"
        },
        rightPriceScale: {
          borderColor: "rgba(148, 163, 184, 0.18)"
        },
        timeScale: {
          borderColor: "rgba(148, 163, 184, 0.18)",
          timeVisible: true,
          secondsVisible: false
        },
        width: size.width,
        height: size.height
      });

      lineSeries = createSeries(chart, "LineSeries", {
        color: "#38bdf8",
        lastValueVisible: true,
        lineWidth: 2,
        priceLineVisible: true
      });
      candleSeries = createSeries(chart, "CandlestickSeries", {
        borderDownColor: "#ef4444",
        borderUpColor: "#22c55e",
        downColor: "#ef4444",
        priceLineVisible: true,
        upColor: "#22c55e",
        wickDownColor: "#ef4444",
        wickUpColor: "#22c55e"
      });
      candleSeries.applyOptions({ visible: false });

      resizeObserver = new ResizeObserver(() => {
        const nextSize = getContainerSize();
        if (nextSize.width <= 0 || nextSize.height <= 0) {
          return;
        }

        if (!chart) {
          ensureChart();
          return;
        }

        chart.applyOptions({
          width: nextSize.width,
          height: nextSize.height
        });
      });
      resizeObserver.observe(container);
      return true;
    }

    function clearPriceLines() {
      for (const line of priceLines) {
        try {
          lineSeries.removePriceLine?.(line);
        } catch {}
        try {
          candleSeries.removePriceLine?.(line);
        } catch {}
      }
      priceLines = [];
    }

    function clearMarkers() {
      if (lineSeries) {
        setMarkers(lineSeries, [], lineMarkers);
      }
      if (candleSeries) {
        setMarkers(candleSeries, [], candleMarkers);
      }
    }

    function updatePriceLines(payload) {
      clearPriceLines();
      const levels = [];
      if (payload?.position?.entryPrice) {
        levels.push({ color: "#38bdf8", price: payload.position.entryPrice, title: "ENTRY" });
      }
      const activeSeries = currentMode === "candlestick" ? candleSeries : lineSeries;
      for (const level of levels) {
        if (!level.price || !activeSeries?.createPriceLine) continue;
        priceLines.push(activeSeries.createPriceLine({
          axisLabelVisible: true,
          color: level.color,
          lineStyle: 2,
          lineWidth: 1,
          price: level.price,
          title: level.title
        }));
      }
    }

    function setSeriesVisibility(mode) {
      currentMode = mode;
      lineSeries.applyOptions({ visible: mode === "line" });
      candleSeries.applyOptions({ visible: mode === "candlestick" });
      clearPriceLines();
    }

    function resetDataState(symbol) {
      currentSymbol = symbol;
      lastLineTime = null;
      lastCandleTime = null;
      didFitContent = false;
      currentContextKey = null;
      if (lineSeries) {
        lineSeries.setData([]);
      }
      if (candleSeries) {
        candleSeries.setData([]);
      }
      clearMarkers();
      clearPriceLines();
    }

    function applyIncrementalLineData(lineData) {
      if (!Array.isArray(lineData) || lineData.length <= 0) {
        lineSeries.setData([]);
        lastLineTime = null;
        return;
      }
      if (lastLineTime === null) {
        lineSeries.setData(lineData);
        lastLineTime = lineData[lineData.length - 1].time;
        return;
      }

      const newPoints = lineData.filter((point) => point.time >= lastLineTime);
      if (newPoints.length <= 0) return;
      for (const point of newPoints) {
        lineSeries.update(point);
      }
      lastLineTime = lineData[lineData.length - 1].time;
    }

    function applyIncrementalCandleData(candleData) {
      if (!Array.isArray(candleData) || candleData.length <= 0) {
        candleSeries.setData([]);
        lastCandleTime = null;
        return;
      }
      if (lastCandleTime === null) {
        candleSeries.setData(candleData);
        lastCandleTime = candleData[candleData.length - 1].time;
        return;
      }

      const newCandles = candleData.filter((candle) => candle.time >= lastCandleTime);
      if (newCandles.length <= 0) return;
      for (const candle of newCandles) {
        candleSeries.update(candle);
      }
      lastCandleTime = candleData[candleData.length - 1].time;
    }

    function updateLegend(payload) {
      if (titleNode) {
        titleNode.textContent = payload?.symbol || "Chart";
      }
      if (!legendNode) return;
      const currentCandles = Array.isArray(payload?.candles?.[currentTimeframe]) ? payload.candles[currentTimeframe] : [];
      const activeTimeframe = currentCandles.length > 0 ? currentCandles[currentCandles.length - 1] : null;
      legendNode.innerHTML = [
        payload?.lastPrice ? `<span>Last ${Number(payload.lastPrice).toFixed(4)}</span>` : "",
        payload?.position?.entryPrice ? `<span>Entry ${Number(payload.position.entryPrice).toFixed(4)}</span>` : "",
        activeTimeframe ? `<span>O/H/L/C ${Number(activeTimeframe.open).toFixed(4)} / ${Number(activeTimeframe.high).toFixed(4)} / ${Number(activeTimeframe.low).toFixed(4)} / ${Number(activeTimeframe.close).toFixed(4)}</span>` : ""
      ].filter(Boolean).join("");
    }

    function update(payload) {
      if (!ensureChart()) {
        return;
      }
      const symbol = payload?.symbol || null;
      if (symbol !== currentSymbol) {
        resetDataState(symbol);
      }

      const lineData = Array.isArray(payload?.lineData) ? payload.lineData : [];
      const candles = payload?.candles?.[currentTimeframe] || [];
      const useCandles = Array.isArray(candles) && candles.length > 0;
      const nextContextKey = `${symbol || "n/a"}:${currentTimeframe}:${useCandles ? "candlestick" : "line"}`;
      const activeReferenceData = useCandles ? candles : lineData;
      const markers = projectMarkers(Array.isArray(payload?.markers) ? payload.markers : [], activeReferenceData);

      if (currentContextKey !== nextContextKey) {
        clearMarkers();
        clearPriceLines();
        currentContextKey = nextContextKey;
      }

      if (useCandles) {
        setSeriesVisibility("candlestick");
        applyIncrementalCandleData(candles);
        setMarkers(candleSeries, markers, candleMarkers);
        setMarkers(lineSeries, [], lineMarkers);
      } else {
        setSeriesVisibility("line");
        setMarkers(candleSeries, [], candleMarkers);
      }

      applyIncrementalLineData(lineData);
      if (!useCandles) {
        setMarkers(lineSeries, markers, lineMarkers);
      }

      updatePriceLines(payload);
      updateLegend(payload);
      if (!didFitContent) {
        chart.timeScale().fitContent();
        didFitContent = true;
      }
    }

    function setTimeframe(nextTimeframe) {
      currentTimeframe = nextTimeframe;
      lastCandleTime = null;
      lastLineTime = null;
      didFitContent = false;
      currentContextKey = null;
      clearMarkers();
    }

    function destroy() {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (chart) {
        chart.remove();
        chart = null;
      }
    }

    return {
      destroy,
      setTimeframe,
      update
    };
  }

  globalScope.ChartAdapter = {
    create: createChartAdapter
  };
})(window);
