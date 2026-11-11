# Client photo delivery

Clients get a private link like `https://speedofphotography.com/g/marcus-gt3-k7q2m9/`.
The page shows their photos in the site's own style. They can view each one full screen, download
single originals, save straight to Photos on a phone, or **Download all** as one zip.

There are no passwords for now, so the code at the end of the link is the key. Make it something nobody
could guess. `new-gallery.ps1` does this for you.

## How it fits together

```
Your PC                                   Cloudflare
───────────────────────────────           ──────────────────────────────────────────────
Pictures\SOP Deliveries\                  R2 bucket "sop-deliveries"  (not set up yet)
  marcus-gt3-k7q2m9\        ── upload ──►   marcus-gt3-k7q2m9/
    gallery.json                              gallery.json
    IMG_0001.jpg                              IMG_0001.jpg
    IMG_0002.jpg                              IMG_0002.jpg  …
    …
                                          speedofphotography.com (Cloudflare Pages)
                                            /g/<code>/                 the client page   g/index.html, delivery.js, delivery.css
                                            /api/gallery/<code>        photo list        functions/api/gallery/[code].js
                                            /api/gallery/<code>/file/… originals         functions/api/gallery/[code]/file/[name].js
                                            /g/sw.js                   Download all zip  (built in the client's browser)
```

## A gallery folder

| File | What it does |
| --- | --- |
| Photos, videos, PDFs | Shown in name order, so `IMG_0002` comes before `IMG_0010`. Images (jpg, png, webp, heic) get previews, videos (mp4, mov) play, anything else is a download tile. |
| `gallery.json` (optional) | Title, client name, date, a note to the client and an expiry date. See [`gallery.json`](gallery.json). |

`gallery.json` fields (all optional):

| Field | Example | Shows as |
| --- | --- | --- |
| `title` | `"Marcus's GT3 RS"` | The big heading. Without it, the heading is "Your photos". |
| `client` | `"Marcus"` | In the line under the heading. |
| `date` | `"2026-11-10"` | "November 10, 2026" under the heading. |
| `message` | `"Thanks for a great shoot!"` | A short note above the photos. Line breaks are kept. |
| `expires` | `"2027-02-01"` | "Available to download until…". After that day the link says the gallery has expired. |

Hidden files (like `.DS_Store`), `gallery.json` itself and anything in sub-folders are never shown.

## Delivering a shoot (once storage is on)

1. Run `new-gallery.ps1` (right-click > Run with PowerShell). Give it the client name and, optionally, the car.
   It creates the folder with a ready `gallery.json` and copies the client link to your clipboard.
2. Export the finished photos into that folder.
3. In the Cloudflare dashboard, go to R2 > `sop-deliveries`, then upload the whole folder.
4. Send the client the link.

To take a gallery down, delete its folder in R2, or set `expires` to a past date.

## Trying it locally

`preview/preview.mjs` runs the real gallery page and functions on this computer, with a pretend R2 bucket
filled with sample galleries from your portfolio photos. Nothing goes online.

```
node _delivery/preview/preview.mjs
```

Then open http://localhost:8788/g/demo-gt3-k7q2m9/. The sample codes are listed when it starts. Previews show the
originals locally, because Cloudflare's resizing only exists on the live site.

## Switching it on (when you're ready)

1. In the Cloudflare dashboard, open R2 and add the R2 subscription. It's free up to 10 GB stored, and downloads
   cost nothing.
2. Create the bucket `sop-deliveries`.
3. In Workers & Pages, open `speedofphotography`, then Settings > Bindings. Add an **R2 bucket** binding named
   `DELIVERY` pointing at `sop-deliveries`.
4. Under Images > Transformations, enable `speedofphotography.com`. This gives smaller previews: 5,000 new sizes a
   month free, and each photo uses 2.
5. On `main`, revert commit `b6071b2` (it took the first version off the live site, so a plain merge would
   leave those files out). Then merge the `photo-delivery` branch into `main`. The home page "paste your gallery
   link" box is already live (commit `03440a5` on `main`, same content as `d56e6cd` here), so expect small,
   same-on-both-sides conflicts in `style.css` and `_layouts/default.html`.

## Limits worth knowing

- R2 free tier: 10 GB stored. A typical 150-photo shoot of full-size JPEGs is about 2–3 GB, so delete old
  galleries or set expiry dates.
- A dashboard upload takes files up to 300 MB each.
- **Download all** streams the zip straight to disk, so big galleries are fine. It needs a current browser
  (Chrome, Edge, Safari or Firefox). Private-browsing windows may not allow it, so clients can still download
  photos one by one.
