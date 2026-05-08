import { AlertCircle } from 'lucide-react'

interface AlertSectionProps {
  readonly error: string | null
  readonly metaError: string | null
}

export function AlertSection({ error, metaError }: AlertSectionProps) {
  if (!error && !metaError) return null

  return (
    <>
      {error && (
        <div className="alert-card alert-error">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Error de conexión</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {metaError && !error && (
        <div className="alert-card alert-warning">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Error de Meta API</p>
            <p className="text-sm mt-1">
              {metaError.includes('#200') || metaError.includes('permission')
                ? 'Tu token de Meta puede necesitar permisos ads_management o ads_read, o appsecret_proof. Reconecta tu cuenta en Integraciones para corregirlo.'
                : metaError}
            </p>
            <a
              href="/integrations"
              className="inline-block mt-2 text-sm font-medium text-primary underline hover:text-accent"
            >
              Ir a Integraciones →
            </a>
          </div>
        </div>
      )}
    </>
  )
}
