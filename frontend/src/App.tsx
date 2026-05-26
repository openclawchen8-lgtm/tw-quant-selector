import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SkeletonLoader from './components/SkeletonLoader';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Signals = lazy(() => import('./pages/Signals'));
const StockDetail = lazy(() => import('./pages/StockDetail'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const Backtest = lazy(() => import('./pages/Backtest'));
const BacktestDetail = lazy(() => import('./pages/BacktestDetail'));
const Strategy = lazy(() => import('./pages/Strategy'));
const Monitor = lazy(() => import('./pages/Monitor'));
const Settings = lazy(() => import('./pages/Settings'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function PageFallback() {
  return <div style={{ padding: '32px' }}><SkeletonLoader variant="card" /><SkeletonLoader variant="table" rows={6} /></div>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Suspense fallback={<PageFallback />}><ErrorBoundary><Dashboard /></ErrorBoundary></Suspense>} />
              <Route path="/signals" element={<Suspense fallback={<PageFallback />}><ErrorBoundary><Signals /></ErrorBoundary></Suspense>} />
              <Route path="/signals/:id" element={<Suspense fallback={<PageFallback />}><ErrorBoundary><StockDetail /></ErrorBoundary></Suspense>} />
              <Route path="/portfolio" element={<Suspense fallback={<PageFallback />}><ErrorBoundary><Portfolio /></ErrorBoundary></Suspense>} />
              <Route path="/backtest" element={<Suspense fallback={<PageFallback />}><ErrorBoundary><Backtest /></ErrorBoundary></Suspense>} />
              <Route path="/backtest/:runId" element={<Suspense fallback={<PageFallback />}><ErrorBoundary><BacktestDetail /></ErrorBoundary></Suspense>} />
              <Route path="/strategy" element={<Suspense fallback={<PageFallback />}><ErrorBoundary><Strategy /></ErrorBoundary></Suspense>} />
              <Route path="/monitor" element={<Suspense fallback={<PageFallback />}><ErrorBoundary><Monitor /></ErrorBoundary></Suspense>} />
              <Route path="/settings" element={<Suspense fallback={<PageFallback />}><ErrorBoundary><Settings /></ErrorBoundary></Suspense>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
