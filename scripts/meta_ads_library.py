import os
import requests
import argparse
import json
from datetime import datetime

# Meta Graph API version
API_VERSION = "v22.0"
BASE_URL = f"https://graph.facebook.com/{API_VERSION}/ads_archive"

def get_active_ads(page_ids, access_token, countries=['ES']):
    """
    Fetches active ads for given page IDs from Meta Ads Library API.
    """
    params = {
        'access_token': access_token,
        'ad_reached_countries': json.dumps(countries),
        'ad_type': 'ALL',
        'search_page_ids': ",".join(page_ids),
        'fields': 'id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,page_id,page_name,publisher_platforms,status',
        'limit': 100
    }

    try:
        response = requests.get(BASE_URL, params=params)
        response.raise_for_status()
        data = response.json()
        
        ads = data.get('data', [])
        
        # Sort by creation time descending
        ads.sort(key=lambda x: x.get('ad_creation_time', ''), reverse=True)
        
        return ads
    except requests.exceptions.RequestException as e:
        print(f"Error fetching ads: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response: {e.response.text}")
        return []

def main():
    parser = argparse.ArgumentParser(description="Extract active ads from Meta Ads Library for specific pages.")
    parser.add_argument("--pages", required=True, help="Comma-separated list of Meta Page IDs")
    parser.add_argument("--token", help="Meta Access Token (defaults to META_ACCESS_TOKEN env var)")
    parser.add_argument("--countries", default="ES", help="Comma-separated list of country codes (default: ES)")
    
    args = parser.parse_args()
    
    token = args.token or os.environ.get("META_ACCESS_TOKEN")
    if not token:
        print("Error: Meta Access Token is required. Set META_ACCESS_TOKEN env var or use --token.")
        return

    page_ids = [p.strip() for p in args.pages.split(",")]
    countries = [c.strip() for c in args.countries.split(",")]
    
    print(f"Fetching active ads for pages: {', '.join(page_ids)} in {', '.join(countries)}...")
    ads = get_active_ads(page_ids, token, countries)
    
    if not ads:
        print("No active ads found or an error occurred.")
        return

    print(f"\nFound {len(ads)} ads. Sorting by date (newest first):\n")
    print("=" * 80)
    
    for ad in ads:
        creation_date = ad.get('ad_creation_time', 'N/A')
        page_name = ad.get('page_name', 'Unknown Page')
        ad_id = ad.get('id', 'N/A')
        
        # Bodies, titles, etc are lists in the API response for ad archive
        bodies = ad.get('ad_creative_bodies', [])
        body = bodies[0] if bodies else "No body text"
        
        snapshot_url = ad.get('ad_snapshot_url', 'N/A')
        platforms = ", ".join(ad.get('publisher_platforms', []))
        
        print(f"DATE: {creation_date}")
        print(f"PAGE: {page_name} (ID: {ad_id})")
        print(f"PLATFORMS: {platforms}")
        print(f"TEXT: {body[:200]}..." if len(body) > 200 else f"TEXT: {body}")
        print(f"SNAPSHOT: {snapshot_url}")
        print("-" * 80)

if __name__ == "__main__":
    main()
