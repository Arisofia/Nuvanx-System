import {
  googleAdsAccountIds,
  metaPixelId,
} from '../lib/env'

const googleAdsIds = googleAdsAccountIds
  ? googleAdsAccountIds.split(',').map((id) => id.trim()).filter(Boolean)
  : []

export const TRACKING_CONFIG = {
  META_PIXEL_ID: metaPixelId,
  GOOGLE_ADS_IDS: googleAdsIds,
  HUBSPOT_PORTAL_ID: import.meta.env.VITE_HUBSPOT_PORTAL_ID?.trim() ?? '',
  HUBSPOT_FORM_ID: import.meta.env.VITE_HUBSPOT_FORM_ID?.trim() ?? '',
  WHATSAPP_PHONE: import.meta.env.VITE_WHATSAPP_PHONE?.trim() ?? '',
  WHATSAPP_MESSAGE: import.meta.env.VITE_WHATSAPP_MESSAGE?.trim() ?? '',
  CALENDAR_URL: import.meta.env.VITE_CALENDAR_URL?.trim() ?? '',
  DOCTORALIA_URL: import.meta.env.VITE_DOCTORALIA_URL?.trim() ?? '',
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
      name: 'DoctoraliaProfileView',
      category: 'profile_view',
      description: 'Doctoralia profile view',
    },
  },
  UTM_PARAMS: [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'gclid',
    'fbclid',
  ],
  THROTTLE: {
    WHATSAPP: 1000,
    FORM: 2000,
    CALENDAR: 1000,
    DOCTORALIA: 1000,
  },
  SCROLL_DEPTH_THRESHOLD: 0.75,
  LANDING_URLS: {
    PRIMARY: import.meta.env.VITE_LANDING_URL_PRIMARY?.trim() ?? '',
    SECONDARY: import.meta.env.VITE_LANDING_URL_SECONDARY?.trim() ?? '',
  },
} as const

export function validateTrackingConfig(): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!TRACKING_CONFIG.META_PIXEL_ID) {
    errors.push('VITE_META_PIXEL_ID is missing')
  }

  if (TRACKING_CONFIG.GOOGLE_ADS_IDS.length === 0) {
    errors.push('VITE_GOOGLE_ADS_ACCOUNT_IDS is missing')
  }

  if (!TRACKING_CONFIG.HUBSPOT_PORTAL_ID) {
    errors.push('VITE_HUBSPOT_PORTAL_ID is missing')
  }

  if (!TRACKING_CONFIG.WHATSAPP_PHONE) {
    errors.push('VITE_WHATSAPP_PHONE is missing')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

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
