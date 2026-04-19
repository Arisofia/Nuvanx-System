import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { AuthProvider } from './context/AuthContext.jsx';
import { useAuth } from './context/useAuth';
import Layout from './components/Layout';
import Login from './pages/Login';

// Lazy-load heavy pages so each route is its own JS chunk
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Playbooks = lazy(() => import('./pages/Playbooks'));
const CRM = lazy(() => import('./pages/CRM'));
const LiveDashboard = lazy(() => import('./pages/LiveDashboard'));
const Integrations = lazy(() => import('./pages/Integrations'));
const AILayer = lazy(() => import('./pages/AILayer'));
const MetaIntelligence = lazy(() => import('./pages/MetaIntelligence'));
const VerifiedFinancials = lazy(() => import('./pages/VerifiedFinancials'));
const CampaignIntelligence = lazy(() => import('./pages/CampaignIntelligence'));

const PageLoader = () => (
  <div className="min-h-screen bg-dark-900 flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="playbooks" element={<Playbooks />} />
          <Route path="operativo" element={<Navigate to="/playbooks" replace />} />
          <Route path="crm" element={<CRM />} />
          <Route path="live" element={<LiveDashboard />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="ai" element={<AILayer />} />
          <Route path="marketing" element={<MetaIntelligence />} />
          <Route path="financials" element={<VerifiedFinancials />} />
          <Route path="intelligence" element={<CampaignIntelligence />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1f2937',
              color: '#f9fafb',
              border: '1px solid #374151',
              borderRadius: '10px',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#10b981', secondary: '#1f2937' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#1f2937' } },
          }}
        />
        <SpeedInsights />
      </AuthProvider>
    </BrowserRouter>
  );
}
