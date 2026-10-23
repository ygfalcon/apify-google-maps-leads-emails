# Google Maps Scraper + Emails: business leads with phone, website and socials

Get a lead list from Google Maps in one run: business name, categories, phone, split address, website, rating, review count and star distribution, opening hours, photo count, coordinates, place ID, plus emails and social profiles pulled from each business website. No login and no Google API key.

## Why this one

| | This actor | compass/crawler-google-places |
|---|---|---|
| Address parts, categories, star distribution, photo count, closed flags | Yes | Yes |
| Description, menu and reservation links, optional reviews | Yes, when Google includes them in the place payload | Yes |
| Emails and socials in the same run | Yes | Paid add-on |
| Price per 1,000 leads with contacts | **$4** ($0.003 place + $0.001 contacts) | About $1.50–$4, contacts extra |
| Unreachable websites | Contact event is not charged | Varies |
| List scroll vs place details | Browser only scrolls the list. Details and websites are parallel HTTP | Browser page per place |

Popular times and price level are read when Google sends them. Logged-out place responses often omit popular times, and the October 2026 samples had no price level string. Photo files are not downloaded; `imagesCount` is the count from the listing.

## Input

```json
{ "searchTerms": ["plumber"], "location": "Tampa, FL", "maxPlacesPerSearch": 50, "extractContacts": true }
```

`maxReviews` defaults to 0. Set it to 1–8 to keep that many reviews from the place payload. That does not open extra review pages.

Google Maps shows up to about 120 places per search. For bigger areas, run several locations or several search terms.

## Measured run (local, no proxy, 23 Oct 2026)

`plumbers` in Tampa, FL, `maxPlacesPerSearch: 50`, `extractContacts: true`.

| Phase | Time |
|---|---|
| List scroll | 2.9s (58 cards found, 50 kept) |
| Place detail HTTP | 435ms average, 0 failures, parallel |
| Website enrichment | 1.3s average, 49 sites, 107 pages |
| Wall clock, first saved through last | **10.5s** (a repeat was 9.0s) |

Fill on those 50 places: rating, review count, star distribution, categories, phone, coordinates, place ID and photo count on all 50. Website on 49. Opening hours and street/city/postal code on 43. Contact fetch succeeded for 46, with an email on 28 and at least one social profile on 36.

The same pipeline on Gramercy Tavern returned the description, an OpenTable reservation link, 10,090 photos, the star distribution, and two reviews when `maxReviews` was 2.

## Example output

```json
{
  "title": "EVERYDAYPLUMBER.com",
  "category": "Plumber",
  "categories": ["Plumber", "Drainage service", "Gas installation service"],
  "address": "3912 W South Ave, Tampa, FL 33614",
  "street": "3912 W South Ave",
  "neighborhood": "Westshore",
  "city": "Tampa",
  "state": "Florida",
  "postalCode": "33614",
  "countryCode": "US",
  "phone": "+18138720200",
  "website": "https://everydayplumber.com/",
  "rating": 4.9,
  "reviewsCount": 1770,
  "reviewsDistribution": { "oneStar": 40, "twoStar": 9, "threeStar": 7, "fourStar": 10, "fiveStar": 1704 },
  "imagesCount": 242,
  "openingHours": ["Friday: Open 24 hours", "Saturday: Open 24 hours"],
  "location": { "lat": 27.991171, "lng": -82.507795 },
  "placeId": "ChIJ3XEHCdDDwogRQANou4CXUic",
  "emails": ["info@everydayplumber.com"],
  "socials": { "instagram": ["https://www.instagram.com/everydayplumber"] },
  "contactsStatus": "ok"
}
```

## Pricing (unchanged, pay per event)

- **place-scraped**: $0.003 per unique business
- **contacts-enriched**: $0.001 per business whose website was reached

1,000 leads with contacts are $4. Set `extractContacts: false` to pay $3 per 1,000.

### Platform cost per 1,000 places

Scaled linearly from the 50-place run above, at 1 GB, using Apify's published unit prices ($0.20 per compute unit, $0.20 per GB of external transfer, $0.005 per 1,000 dataset writes):

| | Per 1,000 with contacts |
|---|---|
| Compute | $0.012 |
| Transfer (place pages + websites) | $0.180 |
| Dataset writes | $0.005 |
| **Total** | **$0.20** |

Datacenter proxy is not billed per GB. Residential proxy is about $8/GB, and this run moved about 0.9 GB per 1,000 places, so residential would erase the margin. The default proxy is Apify datacenter.

Developer revenue after Apify's 20% is $3.20 per 1,000 contacted leads. $0.20 of platform cost is about a 94% margin on that net. Event prices were left unchanged so they can be revised against this cost.

The default run timeout in `.actor/actor.json` is 3600 seconds. A 50-place run no longer needs the old 300 second cap, and a larger run is not cut off at five minutes.

## Use with AI agents

Call it through the Apify MCP server or the Apify API. Every item is one flat object.

## Notes

Only public data is collected. You are responsible for using contact data lawfully (GDPR/CAN-SPAM). The list is scrolled in one browser. Place details and contact pages are fetched over HTTP with a concurrency of 20, and each place is written to the dataset as soon as that place is done.
