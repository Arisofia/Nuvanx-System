/**
 * Unified tracking configuration for NUVANX
 * Synchronizes Meta Pixel, Google Ads, HubSpot, and UTM tracking
 */

export const TRACKING_CONFIG = {
  // Meta Pixel
  META_PIXEL_ID: '1405503384615251',
  
  // Google Ads
  GOOGLE_ADS_ID: 'AW-18182220789',
  
  // HubSpot
  HUBSPOT_PORTAL_ID: '147416356',
  HUBSPOT_FORM_ID: '5042522a-0bc5-4381-ac3e-5aee8649b69c',
  
  // WhatsApp
  WHATSAPP_PHONE: '34669319836',
  WHATSAPP_MESSAGE: 'Hola NUVANX, me gustaría solicitar una valoración médica',
  
  // Google Calendar
  CALENDAR_URL: 'https://calendar.app.google/hbdUARMCmQhqQzKf7',
  
  // Doctoralia
  DOCTORALIA_URL: 'https://www.doctoralia.es/dr-jose-javier-rivera-tejeda',
  
  // Events configuration
  EVENTS: {
    CONTACT: {
      name: 'Contact',
      category: 'lead_whatsapp',
      description: 'WhatsApp contact click',
    },
    LEAD: {
      name: 'Lead',
      category: 'lead_form',
      description: 'HubSpot form submission',
    },
    PROGRAMAR: {
      name: 'Programar',
      category: 'appointment',
      description: 'Calendar booking click',
    },
    DOCTORALIA: {
      name: 'Información de pago añadida',
      category: 'profile_view',
      description: 'Doctoralia profile view',
    },
  },
  
  // UTM parameters to capture
  UTM_PARAMS: [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'gclid',
    'fbclid',
  ],
  
  // Throttling (milliseconds)
  THROTTLE: {
    WHATSAPP: 1000,
    FORM: 2000,
    CALENDAR: 1000,
    DOCTORALIA: 1000,
  },
  
  // Scroll tracking
  SCROLL_DEPTH_THRESHOLD: 0.75, // 75%
  
  // Landing page URLs
  LANDING_URLS: {
    MANUS: 'https://nuvanxlp-nvxf53wk.manus.space',
    CUSTOM: 'https://nuvanx.manus.space',
  },
} as const

/**
 * Validate tracking configuration
 */
export function validateTrackingConfig(): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  
  if (!TRACKING_CONFIG.META_PIXEL_ID) {
    errors.push('META_PIXEL_ID is missing')
  }
  
  if (!TRACKING_CONFIG.GOOGLE_ADS_ID) {
    errors.push('GOOGLE_ADS_ID is missing')
  }
  
  if (!TRACKING_CONFIG.HUBSPOT_PORTAL_ID) {
    errors.push('HUBSPOT_PORTAL_ID is missing')
  }
  
  if (!TRACKING_CONFIG.WHATSAPP_PHONE) {
    errors.push('WHATSAPP_PHONE is missing')
  }
  
  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Get tracking context for API calls
 */
export function getTrackingContext() {
  if (typeof window === 'undefined') {
    return {
      url: '',
      referrer: '',
      userAgent: '',
      timestamp: new Date().toISOString(),
    }
  }
  
  return {
    url: window.location.href,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  }
}
