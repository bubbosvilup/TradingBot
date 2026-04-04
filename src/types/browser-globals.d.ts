// Module responsibility: minimal browser global declarations for externally loaded dashboard libraries.

declare global {
  interface Window {
    LightweightCharts: {
      CrosshairMode?: {
        Normal?: number;
      };
      LineSeries?: unknown;
      CandlestickSeries?: unknown;
      createChart(container: Element | null | undefined, options?: unknown): any;
      createSeriesMarkers?(series: unknown, markers: unknown[]): {
        setMarkers?(markers: unknown[]): void;
      };
      [key: string]: unknown;
    };
    echarts: {
      init(node: Element | null | undefined, theme?: unknown, options?: unknown): any;
    };
    ChartAdapter: {
      create(options: unknown): any;
    };
    DashboardAdapter: {
      create(options: unknown): any;
    };
  }
}

export {};
