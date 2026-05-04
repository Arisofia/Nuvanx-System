import { lazy, Suspense, useContext, useEffect } from 'react'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { useLocation } from 'wouter'
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider, AuthContext } from './contexts/AuthContext'
import Layout from './components/Layout.tsx'
import NotFound from './pages/NotFound.tsx'
import Login from './pages/Login.tsx'

const Dashboard = lazy(() => import('./pages/Dashboard.tsx'))
const Live = lazy(() => import('./pages/Live.tsx'))
const CRM = lazy(() => import('./pages/CRM.tsx'))
const Marketing = lazy(() => import('./pages/Marketing.tsx'))
const Traceability = lazy(() => import('./pages/Traceability.tsx'))
const Financials = lazy(() => import('./pages/Financials.tsx'))
const Intelligence = lazy(() => import('./pages/Intelligence.tsx'))
const Playbooks = lazy(() => import('./pages/Playbooks.tsx'))
const Integrations = lazy(() => import('./pages/Integrations.tsx'))
const AI = lazy(() => import('./pages/AI.tsx'))
const Reports = lazy(() => import('./pages/Reports.tsx'))

const PageLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
)

function Router() {
  const [location, setLocation] = useLocation()
  const auth = useContext(AuthContext)
  const isAuthPage = location === '/login'

  // Redirect to login once auth state is resolved and user is not logged in.
  useEffect(() => {
    if (!isAuthPage && auth && !auth.loading && !auth.isAuthenticated) {
      setLocation('/login')
    }
  }, [auth?.loading, auth?.isAuthenticated, isAuthPage])

  // Show spinner while auth state is loading to avoid flashing protected content.
  if (!isAuthPage && auth?.loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Guard: if auth has resolved and user is not authenticated, render nothing.
  // The useEffect above will redirect to /login on the next tick. Returning null
  // here prevents protected pages (and their data-fetching side-effects) from
  // mounting at all before the redirect fires.
  if (!isAuthPage && !auth?.loading && !auth?.isAuthenticated) {
    return null
  }

  const pageContent = (() => {
    if (location === '/login') {
      return <Login />
    }
    if (location === '/404') {
      return <NotFound />
    }
    if (location === '/dashboard' || location === '/') {
      return <Dashboard />
    }
    if (location === '/live') {
      return <Live />
    }
    if (location === '/crm') {
      return <CRM />
    }
    if (location === '/marketing') {
      return <Marketing />
    }
    if (location === '/traceability') {
      return <Traceability />
    }
    if (location === '/financials') {
      return <Financials />
    }
    if (location === '/intelligence') {
      return <Intelligence />
    }
    if (location === '/playbooks') {
      return <Playbooks />
    }
    if (location === '/integrations') {
      return <Integrations />
    }
    if (location === '/ai') {
      return <AI />
    }
    if (location === '/reports') {
      return <Reports />
    }
    return <NotFound />
  })()

  if (isAuthPage) {
    return (
      <Suspense fallback={<PageLoader />}>
        {pageContent}
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Layout>{pageContent}</Layout>
    </Suspense>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AuthProvider>
            <Router />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
