# Google Maps Scraper + Emails: business leads with phone, website and socials

Get a ready-to-use lead list from Google Maps in one run: business name, category, phone, full address, website, rating, review count, opening hours, coordinates, place ID, **plus emails and social profiles (Facebook, Instagram, LinkedIn, X, TikTok, YouTube) pulled from each business website**. You don't need a login, a Google API key or a second "contact details" actor.

## Why this one
| | This actor | Typical Google Maps scraper |
|---|---|---|
| Emails + socials from website | **Included in one run** | Separate paid add-on or a second actor |
| Price per lead with contacts | **$0.004** ($0.003 place + $0.001 contacts) | ~$0.004–0.006 plus add-ons on the free plan |
| Charged for unreachable websites | **No** (contacts event charged only if the site loaded) | Usually yes |
| Duplicates | Deduped by place ID across all search terms | Varies |
| Clean fields | Tracking params removed from URLs, phones in E.164, hours as "Day: hours" | Raw |
| AI agent / MCP ready | Flat JSON, stable field names, `Leads` table view | Deeply nested output |

## Input
```json
{ "searchTerms": ["plumber"], "location": "Tampa, FL", "maxPlacesPerSearch": 30, "extractContacts": true }
```
Tips: Google Maps shows up to about 120 places per search. For bigger areas, run several locations (neighborhoods or ZIPs) or several distinct search terms.

## Test run (real, Oct 2026: "plumber", Tampa FL, 30 places)
30/30 places with phone and rating · 29 with website · 29 with opening hours · 22 with social profiles · 12 with at least one email · 0 failed requests.

## Example output
```json
{
  "title": "EVERYDAYPLUMBER.com",
  "category": "Plumber",
  "address": "3912 W South Ave, Tampa, FL 33614",
  "phone": "+18138720200",
  "website": "https://everydayplumber.com/",
  "rating": 4.9,
  "reviewsCount": 1769,
  "priceLevel": null,
  "closedStatus": null,
  "plusCode": "XFRR+FV Tampa, Florida",
  "location": {
    "lat": 27.991171,
    "lng": -82.507795
  },
  "placeId": "ChIJ3XEHCdDDwogRQANou4CXUic",
  "cid": "2833493694725227328",
  "googleMapsUrl": "https://www.google.com/maps/place/?q=place_id:ChIJ3XEHCdDDwogRQANou4CXUic",
  "openingHours": [
    "Friday: Open 24 hours: ",
    "Saturday: Open 24 hours: ",
    "Sunday: Open 24 hours: ",
    "Monday: Open 24 hours: ",
    "Tuesday: Open 24 hours: ",
    "Wednesday: Open 24 hours: ",
    "Thursday: Open 24 hours: "
  ],
  "searchTerm": "plumber",
  "rank": 1,
  "emails": [
    "info@everydayplumber.com"
  ],
  "socials": {
    "facebook": [
      "https://www.facebook.com/Everydayplumber",
      "https://www.facebook.com/EVERYDAYPLUMBER"
    ],
    "instagram": [
      "https://www.instagram.com/everydayplumber"
    ],
    "twitter": [
      "https://x.com/PlumberTampa"
    ],
    "linkedin": [
      "https://www.linkedin.com/company/everydayplumber-com"
    ],
    "tiktok": [
      "https://www.tiktok.com/@everydayplumber.com"
    ],
    "youtube": [
      "https://www.youtube.com/channel/UCi5kGwWQmBjmEyaRyWNKV2g"
    ]
  },
  "websitePhones": [
    "8138720200"
  ],
  "contactsStatus": "ok"
}
```

## Pricing (pay per event)
- **place-scraped**: $0.003 per unique business
- **contacts-enriched**: $0.001 per business whose website was reached and scanned

1,000 leads with contacts come to about $4. Set `extractContacts: false` to pay $3 per 1,000.

## Use with AI agents
Call it through the Apify MCP server (`https://mcp.apify.com/?tools=falcon-sol/google-maps-leads-emails`) or the Apify API. Every item is a flat object with `title`, `phone`, `emails[]`, `website`, `socials{}` and `placeId`.

## Notes
Only public data is collected. You're responsible for using contact data lawfully (GDPR/CAN-SPAM). The actor respects rate limits with limited concurrency and retries with backoff.
