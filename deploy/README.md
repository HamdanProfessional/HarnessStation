# Deploying the documentation

Target: **https://hsdocs.retris.io** on your own VPS.

The site is static — about 700 KB of HTML, CSS and JavaScript. There's no
runtime, no database and nothing to keep alive; nginx serves files.

## One-time setup on the VPS

Assuming Ubuntu or Debian. Substitute your own username where it says `deploy`.

### 1. Point the domain at the box

Add an **A record** for `hsdocs` in the `retris.io` DNS, pointing at the VPS's
IPv4 address. Add an **AAAA record** too if it has IPv6.

Check it has propagated before going further — certbot will fail confusingly if
it hasn't:

```bash
dig +short hsdocs.retris.io
```

### 2. Install nginx and create the web root

```bash
sudo apt update
sudo apt install -y nginx

sudo mkdir -p /var/www/hsdocs/releases
sudo chown -R "$USER:$USER" /var/www/hsdocs
```

Owning it as the deploying user matters — otherwise every deploy needs `sudo`
over SSH, which is more setup than it's worth for static files.

Nothing else is needed on the VPS. The deploy uses only `ssh` and `tar`, both of
which are already there — deliberately not rsync, which isn't installed with Git
Bash on Windows.

### 3. Install the site config

From your machine:

```bash
scp deploy/hsdocs.retris.io.conf deploy@hsdocs.retris.io:/tmp/
```

Then on the VPS:

```bash
sudo mv /tmp/hsdocs.retris.io.conf /etc/nginx/sites-available/hsdocs
sudo ln -s /etc/nginx/sites-available/hsdocs /etc/nginx/sites-enabled/
sudo nginx -t          # must say "syntax is ok" before reloading
sudo systemctl reload nginx
```

### 4. Get a certificate

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d hsdocs.retris.io
```

Certbot edits the config in place to add the TLS block and an HTTP→HTTPS
redirect, and installs a renewal timer. Confirm renewal works:

```bash
sudo certbot renew --dry-run
```

### 5. Firewall, if one is enabled

```bash
sudo ufw allow 'Nginx Full'
```

## Deploying

From the repo, every time:

```bash
./deploy/docs.sh
```

That runs the docs tests, builds, rsyncs, and then **checks the live site** —
that a deep link returns the shell and that an asset comes back as JavaScript
rather than the HTML fallback. Both have to hold or it exits non-zero.

To deploy by IP instead of hostname (useful before DNS has propagated):

```bash
HOST=root@203.0.113.10 ./deploy/docs.sh
```

## Rolling back

Each deploy lands in its own directory and `current` is a symlink pointing at it,
so going back is one command on the VPS:

```bash
cd /var/www/hsdocs
ls -1 releases | sort -r          # newest first
ln -sfn releases/<the-one-you-want> current.tmp && mv -Tf current.tmp current
```

No nginx reload needed — it resolves the symlink per request. The last five
releases are kept; change `KEEP` in the deploy script to keep more.

## Why the nginx config looks like that

Two lines carry all the weight.

**`try_files $uri $uri/ /index.html;`** — the docs use clean URLs, so
`/guide/tools` is a route rather than a file on disk. Without this fallback,
every deep link 404s. That includes every link anyone has shared, and the site
looks fine until someone follows one.

**`Cache-Control: no-cache` on `index.html`** — asset filenames contain a content
hash and are cached for a year, which is safe because a given URL's contents can
never change. But `index.html` is what *points* at those assets. Cached, a
returning visitor loads an old shell referencing files that no longer exist, and
gets a blank page. This is the single most common way a static deploy appears to
have worked and hasn't.

## Checking it by hand

```bash
curl -I https://hsdocs.retris.io/                    # 200
curl -I https://hsdocs.retris.io/guide/tools         # 200, text/html
curl -I https://hsdocs.retris.io/assets/<hashed>.js  # 200, text/javascript
```

That third one is the check worth remembering. If an asset comes back as
`text/html`, the fallback is catching it and the page will be blank — with a 200
in the network tab, which is why it's easy to miss.

## If something's wrong

**Deep links 404** — `try_files` is missing, or nginx wasn't reloaded.

**The page is blank** — assets are being served as HTML. Check the content type
of the script URL in the page source.

**Changes don't appear** — `index.html` is being cached somewhere. Check the
response headers; if nginx is sending `no-cache` and you still see it, something
in front (Cloudflare, a proxy) is caching.

**certbot fails** — DNS hasn't propagated, or port 80 isn't reachable. Certbot
needs to answer an HTTP challenge on the domain.

**Permission denied on rsync** — `/var/www/hsdocs` isn't owned by the deploying
user. See step 2.
