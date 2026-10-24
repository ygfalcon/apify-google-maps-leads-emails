# 📍 Google Maps Scraper + Emails: Business Leads & Socials

**Type a business type and a city, get a ready-to-call lead list.** Every Google Maps result comes with phone, website, full address, rating and star breakdown, hours and coordinates, plus **emails and social profiles pulled from the business's own website**, all in the same run. No login, no Google API key, no add-ons to configure.

## 🎯 Who it's for
- **Agencies and freelancers** prospecting local businesses (web design, SEO, ads, reputation management)
- **B2B sales teams** building territory lists for cold email and cold calling
- **SaaS and service companies** selling to restaurants, clinics, contractors, salons, gyms and more
- **Market researchers** mapping competitors, ratings and review volume by city
- **Developers and AI agents** that need local business data behind a simple API

## 🚀 Why this one
- 📧 **Emails and socials built in.** Contact enrichment is on by default and visits each business's home, contact, about and impressum pages. It decodes hidden emails (Cloudflare-protected, `name [at] domain (dot) com`), validates phone numbers and finds 13 social networks. There's no separate add-on to find and enable.
- 💸 **Two flat prices, no tiers.** $0.0034 per place and $0.0015 only when the website loaded and an email, phone, or social was kept. Unreachable sites, failed lookups, and empty extractions aren't charged for contacts.
- ⚡ **Fast.** Only the results list uses a browser. Place details and websites are fetched in parallel over HTTP, and each lead is saved as soon as it's done. In our measured test, 50 Tampa plumbers *with* contacts took about 20 seconds.
- 🧱 **Spreadsheet-ready rows.** The address is split into street, neighborhood, city, state, postal code and country, there are five star-count columns, and `contactsStatus` tells you why a row has no email.
- ⭐ **Quality filters.** Set a minimum rating, skip closed places, and optionally keep up to 8 reviews per place.
- 🔌 **Works everywhere.** Export CSV, Excel or JSON, or connect through the API, Zapier, Make, Google Sheets or the Apify MCP server.

## ⚡ Quick start
1. Enter **Search terms**, e.g. `dentist`, `plumber`, `roofing contractor`.
2. Enter a **Location**, e.g. `Austin, TX`.
3. Set **Max places per search term** and click **Start**.

```json
{ "searchTerms": ["plumber"], "location": "Tampa, FL", "maxPlacesPerSearch": 50, "extractContacts": true }
```

> 💡 Google Maps shows up to about 120 places per search. If you set the max above that and a search comes back full, the actor splits the map into closer views and keeps going. You can still add nearby cities, ZIP codes, or extra search terms.

## 📊 Sample output (real result from a test run, 23 Oct 2026)
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

### Measured run: "plumber" in Tampa, FL (50 places, contacts on, local, no proxy, 24 Oct 2026)
| | Result |
|---|---|
| Wall clock, start to finish | **about 21 s** |
| Rating, reviews, star distribution, categories, phone, coordinates, place ID | 50 / 50 |
| Website | 46 / 50 |
| Opening hours / split address | 39 / 50, 40 / 50 |
| Website reached | 46 |
| **At least one email** | **25** |
| At least one social profile | 33 |

Results vary by niche and city. Many small businesses don't publish an email on their site.

## 💵 Pricing, in plain English
| Event | When it's charged | Price |
|---|---|---|
| `place-scraped` | Each unique business saved | **$0.0034** |
| `contacts-enriched` | Only when the site loaded and an email, phone, or social was kept | **$0.0015** |

**1,000 leads with contact enrichment cost at most $4.90.** That's $3.40 for places, plus $1.50 only if every website yields a contact. Turn `extractContacts` off and it's $3.40 per 1,000. Platform usage is included. Splitting a large area, and reading a German Impressum (owner and VAT ID), do not add a charge. Duplicates are not billed twice.

## 💡 Use cases
- Cold-email and cold-call lists for any local niche
- Finding businesses with no website or weak reviews to pitch web design or reputation services
- Competitor mapping: who ranks, their ratings and their review counts
- Territory planning with coordinates and postal codes
- Enriching a CRM (HubSpot, Pipedrive, Salesforce) through Zapier or Make
- Feeding local business data to AI sales agents through the API or MCP

## 🧾 Output fields
`title`, `category`, `categories`, `address`, `street`, `neighborhood`, `city`, `state`, `postalCode`, `countryCode`, `phone`, `website`, `rating`, `reviewsCount`, `reviewsDistribution`, `imagesCount`, `openingHours`, `location`, `placeId`, closed flags, `emails`, `thirdPartyEmails` (a booking tool, parent brand, or agency — not mixed into `emails`), `phones` from the website, `socials`, `impressumOwner` and `vatId` from a German Impressum, `contactsStatus` (`ok`, `skipped`, `no_website`, `website_unreachable`, `website_timeout`, `contacts_failed`), and optional `reviews`. Description, menu and reservation links, popular times and price level are included when Google sends them in the place data. Logged-out responses often leave out popular times. Photo files aren't downloaded, but `imagesCount` is included.

## ❓ FAQ
**Do I need a Google API key or account?**
No. The actor collects public Google Maps data without logging in.

**Why do some rows have no email?**
Check `contactsStatus`. `no_website` means the listing has no site. `website_unreachable`, `website_timeout`, and `contacts_failed` mean the lookup did not finish (you aren't charged for contacts). `ok` with an empty `emails` field means the site published no email; a phone or social on that page is what the contacts charge is for. An `ok` row with no email, phone, or social is not charged for contacts.

**How do I get more than ~120 results?**
Set **Max places per search term** above 120 (up to 500). When a search fills the feed, the actor automatically splits that map into four closer views and continues until it reaches your max or the businesses run out. A search that simply has fewer businesses is left as it is. You can still add neighborhoods, ZIPs, or extra terms yourself.

**Can I get reviews?**
Yes. Set `maxReviews` from 1 to 8 to keep that many reviews per place. It doesn't open extra review pages.

**Which proxy should I use?**
The default Apify datacenter proxy stays on and works for most runs. If the proxy cannot be reached, the run continues with a direct connection instead of timing out. Switch to residential only if you see blocks.

**Is it legal?**
It collects only publicly available business data. You're responsible for using contact data lawfully (GDPR, CAN-SPAM and similar laws).

**Saved task not returning emails?**
A saved Apify task keeps its old input. Make sure "Extract emails & socials from websites" is checked in that task.

---
*Keywords: Google Maps scraper, Google Maps email extractor, Google Maps leads, local business leads, business email finder, Google Places scraper without API, lead generation tool, B2B prospecting, contact scraper, phone number scraper, Google Maps data export to CSV and Excel.*

---

**Built by [falcon.sol](https://x.com/ygfalcon)**: anon dev shipping pay-per-call data tools and x402 APIs for builders and agents. [X](https://x.com/ygfalcon) · [GitHub](https://github.com/ygfalcon) · [Apify](https://apify.com/falcon-sol)

## Comparison (falcon.sol, 24 Oct 2026)

I ran the same five searches, 10 places each, with website contacts on and no rating, website, or closed-place filters:

`plumber in Tampa, Florida` · `dentist in Austin, Texas` · `electrician in Denver, Colorado` · `hair salon in Chicago, Illinois` · `lawyer in Berlin, Germany`

The other columns are the three most-used Apify actors that save one row per place, ranked by `totalUsers30Days` on the public actor record that day. `compass/Google-Maps-Reviews-Scraper` had 8,553 users in 30 days, second among Maps actors, and it returns reviews, so it is not in this table.

| | This actor | [compass/crawler-google-places](https://apify.com/compass/crawler-google-places) | [compass/google-maps-extractor](https://apify.com/compass/google-maps-extractor) | [lukaskrivka/google-maps-with-contact-details](https://apify.com/lukaskrivka/google-maps-with-contact-details) |
|---|---:|---:|---:|---:|
| Users, last 30 days |  | 44,954 | 2,284 | 2,531 |
| Places saved | 50 | 50 | 50 | 50 |
| Unique place IDs | 50 | 50 | 50 | 50 |
| With a phone | 49 | 49 | 49 | 49 |
| With an email in `emails` | **31** | 30 | 31 | 28 |
| Email addresses in `emails` | 37 | 45 | 47 | 47 |
| With a social profile | 33 | 34 | 36 | 35 |
| Social URLs | 110 | 126 | 141 | 177 |
| Wall clock | **15.5 s** local, no proxy | 153 s on Apify | 212 s on Apify | 161 s on Apify |
| Cost per 1,000 places, Free-plan list price, this contact mix | **$4.87** | $5.92 | $9.00 | $7.45 |

List prices used (`pricing.json` was not edited; it is $0.0034 per place and $0.0015 per site reached):

- This actor: $0.0034 per place, plus $0.0015 for each website that loaded (49 of 50). 50 × $0.0034 + 49 × $0.0015 = $0.2435 for this sample, which is $4.87 per 1,000.
- Compass Maps Scraper, Free tier: $0.004 per place and $0.002 per company-contacts enrichment. The run charged 50 places and 48 contact enrichments, which is $5.92 per 1,000, plus a $0.0001 start fee on that run.
- Compass Extractor, Free tier: $0.005 per place and $0.004 per contacts enrichment (50 and 50). $9.00 per 1,000, plus $0.0001 to start.
- Email Extractor, Free tier: $0.005 per place and $0.0025 per contacts enrichment (50 and 49). $7.45 per 1,000, plus $0.0001 to start.

The three hosted runs started together at 13:39 UTC and cost $0.296, $0.450, and $0.373. Mine finished in 15.5 seconds on this machine, direct connection, a minute earlier. Place IDs in common: 32 with the Maps Scraper, 31 with the Extractor, 32 with the Email Extractor. Google's order moved between the runs.

On the overlap, the extra strings in their `emails` arrays were a Berlin bar association, a web agency, or a second domain of the same firm. Those sit in `thirdPartyEmails` here (8 addresses on 4 rows). All three of them saved `twitter.com/wix` on Williams and Sons Electric. That URL is dropped here.

Spot-check of 30 of my rows, six from each search, against a fresh Maps detail fetch and the business site: the name matched 30/30, the phone matched 29/29 (All Electric had no phone), and all 21 email addresses were `mailto` links on that site. Two are off the homepage: `karen@karenmariesalon.com` on the team page, and `redcappresident@redcapnow.com` on the contact page. On the rows they also returned inside those 30, their names and phones matched the same fresh fetch (18, 18, and 20 names). I did not find `presse@cdr-legal.de`, which all three saved, on the CDR Legal homepage.
