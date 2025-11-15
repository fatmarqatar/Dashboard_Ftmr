import React from 'react'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // you can log to an external service here
    // console.error('ErrorBoundary caught:', error, info)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 m-6 rounded bg-red-50 text-red-800">
          <h2 className="text-lg font-semibold">Something went wrong.</h2>
          <p className="mt-2 text-sm">An error occurred while rendering this section.</p>
          <div className="mt-4">
            <button onClick={this.handleRetry} className="px-3 py-1 bg-red-600 text-white rounded mr-2">Retry</button>
            <button onClick={() => window.location.reload()} className="px-3 py-1 bg-gray-200 rounded">Reload Page</button>
          </div>
          <details className="mt-3 text-xs text-red-700">
            <summary>Show error</summary>
            <pre className="whitespace-pre-wrap">{String(this.state.error)}</pre>
          </details>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
