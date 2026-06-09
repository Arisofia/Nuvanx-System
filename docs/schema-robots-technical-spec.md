# Technical spec · robots.txt + JSON-LD

## robots.txt

Allow public SEO pages for AI crawlers and block private or system paths.

Recommended user agents:

- GPTBot
- OAI-SearchBot
- ClaudeBot
- PerplexityBot
- Googlebot
- Bingbot

## Suggested policy

User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Sitemap: https://nuvanx.com/sitemap.xml

User-agent: GPTBot
Allow: /
Disallow: /wp-admin/
Disallow: /wp-login.php

User-agent: OAI-SearchBot
Allow: /
Disallow: /wp-admin/
Disallow: /wp-login.php

User-agent: ClaudeBot
Allow: /
Disallow: /wp-admin/
Disallow: /wp-login.php

User-agent: PerplexityBot
Allow: /
Disallow: /wp-admin/
Disallow: /wp-login.php

## JSON-LD home

Implement MedicalBusiness for NUVANX plus Physician entities for the clinical team.

Required fields:

- name
- url
- telephone
- address
- geo
- openingHoursSpecification
- medicalSpecialty
- areaServed
- sameAs
- employee or founder references

## Location schema

Create separate entities for Chamberí and Goya / Salamanca.

## Validation

- Google Rich Results Test
- Schema.org validator
- Search Console URL inspection
