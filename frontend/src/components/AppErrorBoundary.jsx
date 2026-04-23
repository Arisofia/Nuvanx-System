import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[AppErrorBoundary] Unhandled runtime error', {
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    });
  }

  handleReload = () => {
    globalThis.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = this.state.error?.message || 'Unexpected runtime error';
    const isChunkError = /dynamically imported module|loading chunk|ChunkLoadError/i.test(message);

    return (
      <div className="min-h-screen bg-dark-900 text-white flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-dark-800 border border-dark-600 rounded-2xl p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={20} />
            <div>
              <h1 className="text-lg font-semibold">Application error</h1>
              <p className="text-sm text-gray-300 mt-2">
                {isChunkError
                  ? 'A deployment asset mismatch was detected (stale JS chunk). Reload the app to fetch the latest bundle.'
                  : 'An unexpected error interrupted rendering. Reload and retry.'}
              </p>
              <p className="text-xs text-gray-500 mt-3 break-words">{message}</p>
              {/* @copilot: explicit non-submit button avoids accidental form submission semantics. */}
              <button
                type="button"
                onClick={this.handleReload}
                className="btn-secondary mt-4 inline-flex items-center gap-2"
              >
                <RefreshCw size={14} /> Reload app
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
