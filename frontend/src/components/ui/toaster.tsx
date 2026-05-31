import { Toaster as HotToaster } from 'react-hot-toast'

/**
 * Application Toaster.
 *
 * Currently powered by react-hot-toast.
 *
 * TODO (future improvement):
 * Consider migrating to the "sonner" library for a more modern toast experience
 * (https://sonner.emilkowal.ski/).
 */
export function Toaster() {
  return <HotToaster position="top-center" richColors closeButton />
}
