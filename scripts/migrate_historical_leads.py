#!/usr/bin/env python3
"""Migración histórica de leads Meta para unificar registros de Francisco Antonio y Nuvanx.

Este script recorre los leads de Facebook/Meta Lead Ads para unificar la línea única
en tu CRM usando el teléfono extraído de field_data.

Uso:
  META_ACCESS_TOKEN=tu_token_de_acceso META_PAGE_ID=685010274687129 python3 scripts/migrate_historical_leads.py
"""

import os
import sys
import hmac
import hashlib
import requests

ACCESS_TOKEN = os.getenv('META_ACCESS_TOKEN', 'tu_token_de_acceso')
PAGE_ID = os.getenv('META_PAGE_ID', '685010274687129')
API_VERSION = os.getenv('META_API_VERSION', 'v21.0')
META_APP_SECRET = os.getenv('META_APP_SECRET', '')
API_BASE = f'https://graph.facebook.com/{API_VERSION}/'


def compute_appsecret_proof(access_token, app_secret):
    return hmac.new(
        app_secret.encode('utf-8'),
        access_token.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()


def normalize_field_data(field_data):
    customer_info = {}
    for f in field_data or []:
        key = str(f.get('name') or f.get('field_name') or '').strip()
        if not key:
            continue
        values = f.get('values') or []
        if values:
            customer_info[key] = values[0]
        elif f.get('value') is not None:
            customer_info[key] = f['value']
    return customer_info


def classify_tag(customer_info):
    text = ' '.join(str(value).lower() for value in customer_info.values())
    if 'botox' in text or 'neuromodulador' in text:
        return 'neuromodulador/botox'
    return 'general'


def mask_phone(phone):
    value = str(phone or '')
    digits = ''.join(ch for ch in value if ch.isdigit())
    if len(digits) <= 4:
        return '****'
    return f'****{digits[-4:]}'


def update_crm_record(phone, campaign_name, ad_name, tag):
    """Reemplaza esta función con tu actualización real del CRM o base de datos."""
    _ = phone  # Mantener firma para compatibilidad; no registrar datos sensibles.
    print(f'Sincronizado lead <- {campaign_name} | ad: {ad_name} | tag: {tag}')
    return True


def migrate_historical_leads():
    next_url = f'{API_BASE}{PAGE_ID}/leads'
    params = {
        'fields': 'id,field_data,campaign_name,ad_name,form_name,created_time',
        'access_token': ACCESS_TOKEN,
        'limit': 100,
    }
    if META_APP_SECRET:
        params['appsecret_proof'] = compute_appsecret_proof(ACCESS_TOKEN, META_APP_SECRET)
    total_updated = 0

    while next_url:
        response = requests.get(next_url, params=params)
        response.raise_for_status()
        data = response.json()

        leads = data.get('data', [])
        for lead in leads:
            customer_info = normalize_field_data(lead.get('field_data', []))
            phone = customer_info.get('phone_number') or customer_info.get('telefono')
            tag = classify_tag(customer_info)

            if phone:
                update_crm_record(phone, lead.get('campaign_name'), lead.get('ad_name'), tag)
                total_updated += 1
            else:
                print(f'Skipping lead without phone: {lead.get("id")}')

        paging = data.get('paging', {})
        next_url = paging.get('next')
        params = None

    return total_updated


if __name__ == '__main__':
    if ACCESS_TOKEN == 'tu_token_de_acceso':
        print('WARNING: META_ACCESS_TOKEN no está configurado. Establece la variable de entorno antes de ejecutar.')

    try:
        updated = migrate_historical_leads()
        print(f'Total sincronizados: {updated}')
    except Exception as exc:
        print(f'Error durante la migración: {exc}', file=sys.stderr)
        sys.exit(1)
