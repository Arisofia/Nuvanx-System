import { lazy, Suspense, useContext, useEffect } from 'react'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { useLocation } from 'wouter'
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider, AuthContext } from './contexts/AuthContext'
import Layout from './components/Layout'
import MetaAccountsNotice from './components/MetaAccountsNotice'
import NotFound from './pages/NotFound'
import Login from './pages/Login'
import { useMetaPageView, useMetaContextCapture } from './lib/metaPixel'
import { isSupabaseConfigured } from './lib/env'

function ConfigurationError() {
  return (
    <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center p-6">
      <div className="text-center space-y-4 max-w-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Nuvanx · Control Centre</p>
        <h1 className="text-xl font-serif font-bold text-[#2C2825]">Configuración incompleta</h1>
        <p className="text-sm text-[#5C5550]">
          Las variables de entorno de Supabase no están configuradas.
          Añade <code className="bg-[#F0ECE6] px-1 rounded text-xs">VITE_SUPABASE_URL</code> y{' '}
          <code className="bg-[#F0ECE6] px-1 rounded text-xs">VITE_SUPABASE_ANON_KEY</code> en
          el panel de Vercel y vuelve a desplegar.
        </p>
      </div>
    </div>
  )
}

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Live = lazy(() => import('./pages/Live'))
const CrmPage = lazy(() => import('./pages/CRM'))
const Marketing = lazy(() => import('./pages/Marketing'))
const Traceability = lazy(() => import('./pages/Traceability'))
const Financials = lazy(() => import('./pages/Financials'))
const Intelligence = lazy(() => import('./pages/Intelligence'))
const Playbooks = lazy(() => import('./pages/Playbooks'))
const SalesPlaybook = lazy(() => import('./pages/SalesPlaybook'))
const Integrations = lazy(() => import('./pages/Integrations'))
const AiPage = lazy(() => import('./pages/AI'))
const Reports = lazy(() => import('./pages/Reports'))
const LeadAudit = lazy(() => import('./pages/LeadAudit'))

const PageLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
)

function Router() {
  const [location, setLocation] = useLocation()
  const auth = useContext(AuthContext)
  const isAuthPage = location === '/login'

  // Fire Meta Pixel PageView on every route change.
  useMetaPageView()
  // Capture Meta click IDs and browser IDs.
  useMetaContextCapture()

  // Redirect to login once auth state is resolved and user is not logged in.
  useEffect(() => {
    if (!isAuthPage && auth && !auth.loading && !auth.isAuthenticated) {
      setLocation('/login')
    }
  }, [auth?.loading, auth?.isAuthenticated, isAuthPage, setLocation, auth])

  // Show spinner while auth state is loading to avoid flashing protected content.
  if (!isAuthPage && auth?.loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Guard: if auth has resolved and user is not authenticated, render the login
  // view while the route transition completes. Returning null here caused a
  // blank production screen when the redirect effect did not flush immediately.
  if (!isAuthPage && !auth?.loading && !auth?.isAuthenticated) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Login />
      </Suspense>
    )
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
      return <CrmPage />
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
    if (location === '/sales-playbook') {
      return <SalesPlaybook />
    }
    if (location === '/integrations') {
      return <Integrations />
    }
    if (location === '/ai') {
      return <AiPage />
    }
    if (location === '/reports') {
      return <Reports />
    }
    if (location === '/reports/lead-audit') {
      return <LeadAudit />
    }
    return <NotFound />
  })()

  const pageContentWithBoundary = (() => {
    const pageRoutesWithBoundary = ['/dashboard', '/', '/crm', '/marketing']
    if (pageRoutesWithBoundary.includes(location)) {
      return (
        <ErrorBoundary
          fallback={
            <div className="min-h-screen bg-background flex items-center justify-center">
              <div className="max-w-lg text-center px-4">
                <p className="text-base text-foreground">Ha ocurrido un error cargando esta sección.</p>
              </div>
            </div>
          }
        >
          {pageContent}
        </ErrorBoundary>
      )
    }
    return pageContent
  })()

  if (isAuthPage) {
    return (
      <Suspense fallback={<PageLoader />}>
        {pageContentWithBoundary}
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Layout>{pageContentWithBoundary}</Layout>
    </Suspense>
  )
}

export default function App() {
  if (!isSupabaseConfigured) {
    return <ConfigurationError />
  }

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AuthProvider>
            <Router />
            <MetaAccountsNotice />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
