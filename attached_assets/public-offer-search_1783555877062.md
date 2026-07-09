# Public Offer Search API (partner integration)

No-auth, CORS-enabled endpoint so external sites (e.g. Find Business Reviews) can check whether a business has live offers on Wowlette and link users into the add-to-wallet flow.

## Endpoint

```
GET https://<wowlette-domain>/api/public/offers/search?name=<business name>
```

- No authentication required. CORS is open (`Access-Control-Allow-Origin: *`).
- `name` is fuzzy-matched case-insensitively against active business names (substring in either direction, so "Atlas Coffee Roasters Melbourne" still matches "Atlas Coffee Roasters").
- Only live offers are returned: business `active`, offer `active`, expiry date today or later.
- No match or no live offers → `200` with an empty `businesses` array (never an error).

## Example

Request:

```
GET /api/public/offers/search?name=atlas
```

Response:

```json
{
  "query": "atlas",
  "businesses": [
    {
      "id": 1,
      "name": "Atlas Coffee Roasters",
      "address": "12 Beacon Street, Boston, MA",
      "website": "atlascoffee.example.com",
      "offers": [
        {
          "id": 1,
          "title": "Free pastry with any latte",
          "offerType": "Free Item",
          "description": "Buy any latte and choose a fresh pastry on the house.",
          "terms": "One per customer per day. Dine-in or takeaway.",
          "expiryDate": "2026-08-07",
          "addToWalletUrl": "https://<wowlette-domain>/browse?offer=1"
        }
      ]
    }
  ]
}
```

## Add-to-wallet deep link

`addToWalletUrl` points at `/browse?offer=<id>` on Wowlette:

- Logged-in customers: the offer is added to their wallet immediately.
- Logged-out visitors: they are sent through login/signup and the offer is auto-added afterward.

Suggested button on the partner site: **"Add offer to Wowlette Wallet"** linking to `addToWalletUrl`.
