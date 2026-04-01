// Module responsibility: encapsulate ECharts analytics rendering for the observability UI.

(function registerDashboardAdapter(globalScope) {
  function createChart(node, title) {
    const chart = globalScope.echarts.init(node, null, { renderer: "canvas" });
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      grid: {
        bottom: 36,
        left: 44,
        right: 18,
        top: 42
      },
      legend: {
        textStyle: { color: "#cdd6e5" },
        top: 8
      },
      textStyle: {
        color: "#cdd6e5"
      },
      title: {
        left: 12,
        text: title,
        textStyle: {
          color: "#e7eefc",
          fontSize: 14,
          fontWeight: 700
        },
        top: 10
      },
      tooltip: {
        trigger: "axis"
      },
      xAxis: {
        axisLabel: {
          color: "#8da1bf"
        },
        axisLine: {
          lineStyle: { color: "rgba(148, 163, 184, 0.18)" }
        },
        type: "time"
      },
      yAxis: {
        axisLabel: {
          color: "#8da1bf"
        },
        splitLine: {
          lineStyle: { color: "rgba(148, 163, 184, 0.12)" }
        },
        type: "value"
      }
    });
    return chart;
  }

  function createDashboardAdapter(options) {
    const pnlChart = createChart(options.pnlNode, "PnL Over Time");
    const drawdownChart = createChart(options.drawdownNode, "Drawdown");
    const comparisonChart = globalScope.echarts.init(options.comparisonNode, null, { renderer: "canvas" });
    comparisonChart.setOption({
      animation: false,
      backgroundColor: "transparent",
      grid: {
        bottom: 48,
        left: 40,
        right: 18,
        top: 42
      },
      legend: {
        textStyle: { color: "#cdd6e5" },
        top: 8
      },
      textStyle: {
        color: "#cdd6e5"
      },
      title: {
        left: 12,
        text: "Per-Bot Comparison",
        textStyle: {
          color: "#e7eefc",
          fontSize: 14,
          fontWeight: 700
        },
        top: 10
      },
      tooltip: {
        trigger: "axis"
      },
      xAxis: {
        axisLabel: {
          color: "#8da1bf",
          interval: 0,
          rotate: 20
        },
        axisLine: {
          lineStyle: { color: "rgba(148, 163, 184, 0.18)" }
        },
        type: "category"
      },
      yAxis: [
        {
          axisLabel: { color: "#8da1bf" },
          splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.12)" } },
          type: "value"
        },
        {
          axisLabel: { color: "#8da1bf" },
          type: "value"
        }
      ]
    });

    const resizeObserver = new ResizeObserver(() => {
      pnlChart.resize();
      drawdownChart.resize();
      comparisonChart.resize();
    });
    resizeObserver.observe(options.pnlNode);
    resizeObserver.observe(options.drawdownNode);
    resizeObserver.observe(options.comparisonNode);

    function update(payload) {
      const botSeries = Array.isArray(payload?.botSeries) ? payload.botSeries : [];
      const comparison = Array.isArray(payload?.comparison) ? payload.comparison : [];

      pnlChart.setOption({
        series: botSeries.map((series, index) => ({
          data: series.pnlSeries,
          name: series.botId,
          showSymbol: false,
          smooth: true,
          type: "line"
        }))
      });

      drawdownChart.setOption({
        series: botSeries.map((series) => ({
          data: series.drawdownSeries,
          areaStyle: {
            opacity: 0.08
          },
          name: series.botId,
          showSymbol: false,
          smooth: true,
          type: "line"
        }))
      });

      comparisonChart.setOption({
        series: [
          {
            data: comparison.map((item) => Number(item.pnl || 0)),
            name: "PnL",
            type: "bar"
          },
          {
            data: comparison.map((item) => Number(item.winRate || 0)),
            name: "Win Rate",
            type: "bar",
            yAxisIndex: 1
          },
          {
            data: comparison.map((item) => Number(item.profitFactor || 0)),
            name: "Profit Factor",
            type: "bar",
            yAxisIndex: 1
          }
        ],
        xAxis: {
          data: comparison.map((item) => `${item.botId}\n${item.symbol}`)
        }
      });
    }

    function destroy() {
      resizeObserver.disconnect();
      pnlChart.dispose();
      drawdownChart.dispose();
      comparisonChart.dispose();
    }

    return {
      destroy,
      update
    };
  }

  globalScope.DashboardAdapter = {
    create: createDashboardAdapter
  };
})(window);
