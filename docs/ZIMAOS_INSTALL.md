# Installing Outpost on ZimaOS

Outpost isn't in the ZimaOS/CasaOS community App Store yet (see [README's roadmap](../README.md)).
Until then, install it manually as a "custom" Docker app.

## Option A — Custom install via compose (recommended)

1. Open the ZimaOS dashboard → **App Store** → **Install a customized app** (or **Docker Compose** import, depending on your ZimaOS version).
2. Paste in the contents of [`packaging/docker-compose.yml`](../packaging/docker-compose.yml).
3. Before installing, change `JWT_SECRET` to a long random string — this signs login sessions. Generate one with `openssl rand -hex 32`. **Outpost refuses to start in production while this is still the placeholder value**, so a missed step here shows up immediately as a container that exits rather than as a silent security hole.
4. Confirm the host path `/DATA/AppData/outpost` is where you want server worlds, backups, and the app database to live (this is the standard ZimaOS AppData convention).
5. Install, then open the app on the port you published (`7420` by default).
6. On first load you'll be prompted to create the single admin account — do this immediately, since the panel has no other authentication gate.

## Option B — `docker run`

```bash
docker run -d \
  --name outpost \
  --restart unless-stopped \
  -p 7420:3000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e RCON_HOST=host.docker.internal \
  -e HOST_DATA_DIR=/DATA/AppData/outpost \
  --add-host host.docker.internal:host-gateway \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /DATA/AppData/outpost:/data \
  ghcr.io/maskedhere/outpost:latest
```

- `RCON_HOST` and `--add-host`: game-server RCON ports are published on the **host**, not inside
  Outpost's own container, so without these the console and player-management tabs can't reach them.
- `HOST_DATA_DIR` must match the host side of the `/data` mount. Game containers are created through
  the host's Docker daemon, which resolves bind-mount paths on the host; without it, creating a server
  fails with `mkdir /data: read-only file system`.

## Building the image yourself

The published image isn't required — you can build from a clone:

```bash
docker build -f packaging/Dockerfile -t outpost:local .
```

The image is roughly 1.9GB, most of it Chromium. Outpost drives a real headless browser to read
CurseForge, whose search pages sit behind a bot challenge that a plain HTTP request can't get past.
Everything except CurseForge browsing/importing works without it.

## Disk space

Point `/data` at a volume with room. Beyond worlds and backups, Outpost keeps one shared copy of
each Steam-delivered game's files so that only the *first* server of a given game pays for the
download (7 Days to Die is ~14GB). Manage these under **Settings → Game file
cache** — you can pre-download a game there, remove one to reclaim space, or turn the cache off
entirely if you'd rather keep nothing pre-staged.

## Why Outpost needs the Docker socket

Outpost is a single container that creates and manages *other* containers (one per game server) via
the Docker Engine API. That's what `/var/run/docker.sock` is for. This is the same trust model
used by Portainer and Watchtower — the Outpost container effectively has root-equivalent access to
the host. Only install this on a NAS you control, keep the admin password strong, and don't expose
port 7420 directly to the internet without a reverse proxy + auth in front of it.

## Ports game servers use

Each game server you create gets its own host port, allocated starting at `MC_PORT_RANGE_START`
(default `25565`). To let friends connect from outside your LAN, either forward those ports on your
router or use one of the options on each server's **Public access** panel: automatic UPnP mapping, a
playit.gg tunnel, or a bore.pub relay.
