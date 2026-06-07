/**
 * Enhanced Meta Pixel tracking module for NUVANX
 * 
 * Handles conversion events:
 * - Contact (WhatsApp clicks)
 * - Lead (Form submissions)
 * - Programar (Calendar booking)
 * - WhatsAppClick (Custom tracking)
 * - HubSpotFormSubmit (Custom tracking)
 */

import { trackMetaEvent } from './metaPixel'

// Throttling to prevent duplicate events
const eventThrottles = new Map<string, number>()
const THROTTLE_MS = 1000 // 1 second for WhatsApp, 2 seconds for forms

export function canFireEvent(eventKey: string, throttleMs = THROTTLE_MS): boolean {
  const lastFired = eventThrottles.get(eventKey)
  const now = Date.now()
  
  if (!lastFired || now - lastFired >= throttleMs) {
    eventThrottles.set(eventKey, now)
    return true
  }
  
  return false
}

/**
 * Track WhatsApp contact event
 * Fires: Contact (Meta standard), WhatsAppClick (custom)
 */
export function trackWhatsAppClick(phone: string, source: string = 'landing_nuvanx'): void {
  if (!canFireEvent('whatsapp_click', 1000)) return
  
  // Meta standard event
  trackMetaEvent('Contact', {
    content_name: 'WhatsApp CTA',
    content_category: 'lead_whatsapp',
    destination: 'whatsapp',
    phone: phone,
    source: source,
  })
  
  // Custom event for detailed tracking
  trackMetaEvent('WhatsAppClick', {
    phone: phone,
    source: source,
    timestamp: new Date().toISOString(),
  })
  
  // Google Analytics
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', 'whatsapp_click', {
      event_category: 'conversion',
      event_label: 'nuvanx_whatsapp',
      phone: phone,
      source: source,
      value: 1,
    })
  }
  
  // Google Tag Manager
  if (typeof window !== 'undefined' && (window as any).dataLayer) {
    (window as any).dataLayer.push({
      event: 'whatsapp_click',
      conversion_type: 'contact',
      phone: phone,
      source: source,
      timestamp: new Date().toISOString(),
    })
  }
}

/**
 * Track HubSpot form submission
 * Fires: Lead (Meta standard), HubSpotFormSubmit (custom)
 */
export function trackHubSpotFormSubmit(
  formData?: Record<string, unknown>,
  source: string = 'landing_nuvanx'
): void {
  if (!canFireEvent('hubspot_form_submit', 2000)) return
  
  // Meta standard event
  trackMetaEvent('Lead', {
    content_name: 'HubSpot Form',
    content_category: 'lead_form',
    source: source,
    ...formData,
  })
  
  // Custom event for detailed tracking
  trackMetaEvent('HubSpotFormSubmit', {
    source: source,
    timestamp: new Date().toISOString(),
    ...formData,
  })
  
  // Google Analytics
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', 'generate_lead', {
      event_category: 'conversion',
      event_label: 'nuvanx_hubspot_form',
      source: source,
      value: 1,
    })
  }
  
  // Google Tag Manager
  if (typeof window !== 'undefined' && (window as any).dataLayer) {
    (window as any).dataLayer.push({
      event: 'hubspot_form_submit',
      conversion_type: 'lead',
      source: source,
      timestamp: new Date().toISOString(),
      ...formData,
    })
  }
}

/**
 * Track calendar booking event
 * Fires: Programar (Meta standard)
 */
export function trackCalendarBooking(source: string = 'landing_nuvanx'): void {
  if (!canFireEvent('calendar_booking', 1000)) return
  
  trackMetaEvent('Programar', {
    content_name: 'Calendar Booking',
    content_category: 'appointment',
    source: source,
  })
  
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', 'calendar_booking', {
      event_category: 'conversion',
      event_label: 'nuvanx_calendar',
      source: source,
      value: 1,
    })
  }
  
  if (typeof window !== 'undefined' && (window as any).dataLayer) {
    (window as any).dataLayer.push({
      event: 'calendar_booking',
      conversion_type: 'appointment',
      source: source,
      timestamp: new Date().toISOString(),
    })
  }
}

/**
 * Track Doctoralia profile view
 * Fires: Información de pago añadida (Meta standard)
 */
export function trackDoctoraliClick(source: string = 'landing_nuvanx'): void {
  if (!canFireEvent('doctoralia_click', 1000)) return
  
  trackMetaEvent('Información de pago añadida', {
    content_name: 'Doctoralia Profile',
    content_category: 'profile_view',
    source: source,
  })
  
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', 'doctoralia_click', {
      event_category: 'engagement',
      event_label: 'nuvanx_doctoralia',
      source: source,
      value: 1,
    })
  }
}

/**
 * Capture UTM parameters from URL
 */
export function captureUTMParameters(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  
  const params = new URLSearchParams(window.location.search)
  const utms: Record<string, string> = {}
  
  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid']
  
  utmKeys.forEach((key) => {
    const value = params.get(key)
    if (value) utms[key] = value
  })
  
  return utms
}

/**
 * Track page scroll depth
 */
export function trackScrollDepth(threshold = 0.75): void {
  if (typeof window === 'undefined') return
  
  let hasTracked = false
  
  const handleScroll = () => {
    if (hasTracked) return
    
    const scrollHeight = document.documentElement.scrollHeight
    const scrollTop = window.scrollY
    const clientHeight = window.innerHeight
    const scrollPercent = (scrollTop + clientHeight) / scrollHeight
    
    if (scrollPercent >= threshold) {
      trackMetaEvent('ViewContent', {
        content_name: 'Page Scroll',
        content_category: 'engagement',
        value: Math.round(scrollPercent * 100),
      })
      
      if (typeof (window as any).gtag === 'function') {
        (window as any).gtag('event', 'scroll_depth', {
          event_category: 'engagement',
          event_label: 'nuvanx_scroll_75',
          value: Math.round(scrollPercent * 100),
        })
      }
      
      hasTracked = true
    }
  }
  
  window.addEventListener('scroll', handleScroll, { passive: true })
  
  return () => {
    window.removeEventListener('scroll', handleScroll)
  }
}
