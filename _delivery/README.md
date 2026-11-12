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

## SOP Studio: making and managing galleries

**Install it** by running `install-studio.ps1` (right-click > Run with PowerShell). It copies Studio to
`%LOCALAPPDATA%\Programs\SOP Studio` and adds a **SOP Studio** icon to the Desktop and Start menu. Run it again
after Studio changes to update the installed copy; your saved keys and passphrase are kept. To uninstall, delete
that folder and the two shortcuts (and `%APPDATA%\SOP Studio` to forget the keys).

Open it from the icon, or double-click **`Studio.cmd`** in this folder. It opens SOP Studio in your browser at `http://127.0.0.1:4417/`.
There you can make a gallery (the client link is created for you), drag photos in, change the title, note and
end date, delete photos, close a gallery early, or delete it. Keep the black window open while you work.

**Client records (CRM).** Studio also keeps your clients and shoots:

- **Today**: follow-ups due this week, past shoots still marked booked, what's coming up, what's waiting to
  be edited, delivered shoots not yet paid, and galleries closing in the next two weeks.
- **Clients**: contact details, cars, how they found you, notes, their shoots, follow-ups and a history of
  calls, emails and messages. Search, and export to CSV.
- **Shoots**: one per booking, moving Inquiry > Booked > Shot > Editing > Delivered (or Cancelled), with date,
  location, package, payment and a private amount. "Create gallery for this shoot" makes the gallery with the
  title and dates filled in and links it; "Email link" opens a ready-made email to the client.

**Website bookings come in by themselves.** Every request from the booking form on the Packages page is still
emailed to you, and a copy is stored, encrypted, in the bucket (`_inbox/`, by `functions/api/booking.js`). The
website locks it with a public key Studio puts at `_studio/inbox-public.json`; only Studio, unlocked, has the
private key. When you open Studio (and every 5 minutes while it's open) it collects new requests: it matches the
client by email, phone or Instagram (or adds them), fills in only details you hadn't entered, adds the car, makes
an Inquiry shoot with the date, location, shoot type and add-ons, saves the message as a note, adds a "Reply to …"
follow-up for today, and then deletes the request from the bucket. Until Studio has been opened once, requests
are only emailed. The extra form labels and the "How did you hear about me?" choices are in Pages CMS under
"Booking form extra boxes".

The records are encrypted on this PC (`%APPDATA%\SOP Studio\crm.enc`, plus a daily copy for 30 days in
`backups\`), and an encrypted copy is kept in the bucket (`_studio/`, which the gallery pages can never serve).
Set Studio up on another computer with the same passphrase and the records come back.

**Why it's safe.** Studio runs only on your computer. The website has no admin page at all, so there is
nothing online for anyone else to log in to. Studio connects to R2 with an API token that you keep on this PC,
locked with your passphrase:

- The token is saved in `%APPDATA%\SOP Studio\vault.json`, encrypted (AES-256 with a scrypt key). It is never in
  this folder, which is public on GitHub.
- Studio only answers this computer (`127.0.0.1`). Other websites open in your browser can't use it.
- Five wrong passphrases lock sign-in for 5 minutes, then 10, 20 and so on.
- It locks itself after 30 minutes without use, and when you close the window.
- Make the token **Object Read & Write** for the `sop-deliveries` bucket only. Then even the token can't touch
  anything else in your Cloudflare account.

**First run.** Studio asks for your R2 Account ID, Access Key ID and Secret Access Key, and a new passphrase
(12+ characters). To get the keys: Cloudflare dashboard > R2 > Manage API tokens > Create API token, choose
Object Read & Write, apply it to `sop-deliveries` only, create it, and copy the two keys (the secret is shown
once). Studio checks the keys work before saving them.

**Forgot the passphrase?** Delete `%APPDATA%\SOP Studio\vault.json`, delete the old token in Cloudflare, make a
new one, and set Studio up again. Your galleries are untouched.

**If a token might have leaked**, delete it in Cloudflare, make a new one, and paste it under Settings > Replace
R2 keys.

Studio needs Node.js (the LTS version from nodejs.org). It also makes a small preview of each photo in a
hidden `.thumbs` folder inside the gallery, for its own grid. Clients never see it.

## Delivering a shoot (once storage is on)

The easy way is SOP Studio (above). To do it by hand instead:

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
