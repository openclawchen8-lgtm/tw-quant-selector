const API_BASE = '';

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'API error');
  return (body.data ?? body) as T;
}

export interface DashboardData {
  table_counts: Record<string, number>;
  price_date_range: { min: string | null; max: string | null };
  val_date_range: { min: string | null; max: string | null };
  tracker: { dataset: string; status: string; count: number }[];
  top_stocks: { stock_id: string; days: number }[];
}

export function fetchDashboard(): Promise<DashboardData> {
  return request<DashboardData>('/api/v1/dashboard');
}

export function fetchLatestSignals(strategy = 'composite', includeEtf = true) {
  return request(`/api/v1/signals/latest?strategy=${encodeURIComponent(strategy)}&include_etf=${includeEtf}`);
}

export function fetchStockDetail(stockId: string) {
  return request(`/api/v1/stock/${stockId}`);
}

export function fetchSignalCalendar(): Promise<string[]> {
  return request<string[]>('/api/v1/signals/calendar');
}

export function fetchSignalsByDate(date: string, strategy = 'composite', includeEtf = true) {
  return request(`/api/v1/signals/${date}?strategy=${encodeURIComponent(strategy)}&include_etf=${includeEtf}`);
}

export interface FactorHistoryPoint {
  date: string;
  momentum: number | null;
  value: number | null;
  quality: number | null;
  growth: number | null;
}

export function fetchFactorHistory(stockId: string): Promise<FactorHistoryPoint[]> {
  return request<FactorHistoryPoint[]>(`/api/v1/stock/${stockId}/factor-history`);
}

export function fetchStrategyConfig() {
  return request('/api/v1/strategies/config');
}

export interface LogEntry {
  id?: number;
  timestamp: string;
  module: string;
  event: string;
  severity: string;
}

export interface DatasetInfo {
  dataset: string;
  status: string;
  count: number;
  last_updated: string | null;
}

export function fetchMonitorLogs(): Promise<LogEntry[]> {
  return request<LogEntry[]>('/api/v1/monitor/logs');
}

export function fetchMonitorDatasets(): Promise<DatasetInfo[]> {
  return request<DatasetInfo[]>('/api/v1/monitor/datasets');
}

export interface StockSearchResult {
  stock_id: string;
  name: string;
  market: string;
  is_etf: boolean;
  industry: string | null;
}

export function searchStocks(q: string): Promise<StockSearchResult[]> {
  return request<StockSearchResult[]>(`/api/v1/stocks/search?q=${encodeURIComponent(q)}`);
}

export interface EquityPoint {
  date: string;
  value: number;
  benchmark: number | null;
  drawdown: number | null;
}

export function fetchBacktestEquity(runId: string): Promise<EquityPoint[]> {
  return request<EquityPoint[]>(`/api/v1/backtest/${runId}/equity`);
}

export interface BacktestTrade {
  date: string;
  stock_id: string;
  action: string;
  shares: number;
  price: number | null;
  value: number | null;
  weight: number | null;
}

export interface BacktestDetail {
  run_id: string;
  created_at: string | null;
  start_date: string | null;
  end_date: string | null;
  metrics: {
    total_return: number | null;
    cagr: number | null;
    sharpe: number | null;
    max_drawdown: number | null;
    calmar: number | null;
    turnover: number | null;
    total_trades: number;
  };
  trades: BacktestTrade[];
}

export function fetchBacktestDetail(runId: string): Promise<BacktestDetail> {
  return request<BacktestDetail>(`/api/v1/backtest/${runId}/detail`);
}

export interface DatasetStatus {
  name: string;
  status: string;
  count: number;
  last_updated: string | null;
}

export interface DataStatus {
  last_price_update: string | null;
  stock_count: number;
  signal_dates: number;
  latest_signal_date: string | null;
  datasets: DatasetStatus[];
}

export function fetchDataStatus(): Promise<DataStatus> {
  return request<DataStatus>('/api/v1/data/status');
}
