import { lazy, Suspense, ReactNode } from 'react'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { Route, Switch, useLocation } from 'wouter'
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './contexts/useAuth'
import Layout from './components/Layout'
import NotFound from './pages/NotFound'
import Login from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Live = lazy(() => import('./pages/Live'))
const CRM = lazy(() => import('./pages/CRM'))
const Marketing = lazy(() => import('./pages/Marketing'))
const Financials = lazy(() => import('./pages/Financials'))
const Intelligence = lazy(() => import('./pages/Intelligence'))
const Playbooks = lazy(() => import('./pages/Playbooks'))
const Integrations = lazy(() => import('./pages/Integrations'))
const AI = lazy(() => import('./pages/AI'))

const PageLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
)

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) {
    return <PageLoader />
  }
  return isAuthenticated ? children : <Login />
}

function Router() {
  const [location] = useLocation()
  const isAuthPage = location === '/login'

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/404" component={NotFound} />

        <Route path="/">
          {isAuthPage ? null : (
            <ProtectedRoute>
              <Layout>
                <Switch>
                  <Route path="/dashboard" component={Dashboard} />
                  <Route path="/live" component={Live} />
                  <Route path="/crm" component={CRM} />
                  <Route path="/marketing" component={Marketing} />
                  <Route path="/financials" component={Financials} />
                  <Route path="/intelligence" component={Intelligence} />
                  <Route path="/playbooks" component={Playbooks} />
                  <Route path="/integrations" component={Integrations} />
                  <Route path="/ai" component={AI} />
                  <Route path="/" nest>{() => <Dashboard />}</Route>
                </Switch>
              </Layout>
            </ProtectedRoute>
          )}
        </Route>

        <Route component={NotFound} />
      </Switch>
    </Suspense>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
