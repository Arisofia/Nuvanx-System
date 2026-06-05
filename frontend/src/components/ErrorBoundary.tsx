import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="text-center space-y-3 max-w-md">
            <p className="text-sm font-medium text-destructive">Error inesperado</p>
            <p className="text-xs text-muted-foreground">
              {this.state.error?.message ?? 'Algo salió mal. Recarga la página.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="text-xs underline text-muted-foreground hover:text-foreground"
            >
              Recargar
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
