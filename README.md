# SIP lab

A small, self-contained SIP network you can place real calls through, capture,
and deliberately break.

Companion code for **SIP for Backend Developers**, a tutorial series on
[voipbuddies.com](https://www.voipbuddies.com). You do not need the series to
use it, but the posts walk through what each piece does and why.

```bash
docker compose up -d
docker compose exec kamailio kamcmd ul.dump | grep AoR    # two phones registered
docker compose exec app node ctl.js alice dial sip:6000@siplab
```

Six containers, one private Docker network, no published ports, every image tag
pinned. It runs the same on Linux, macOS and Windows, and needs roughly 1 GB of
RAM and a few hundred MB of images.

## The series, and which tag to use

The lab grows as the series goes on. Each part is tagged, so you can check out
the lab exactly as a given post describes it:

```bash
git checkout part-1    # the lab as it stands in part one
```

| Tag | Post |
| --- | --- |
| `part-1` | The Mental Model and a Lab You Can Break |
| `part-2` | The Normal Call, Packet by Packet |

`main` is always the newest version.

---

```
alice ─┐
       ├─► kamailio ─┬─► bob          (another softphone)
bob  ──┘   (proxy)   ├─► asterisk     6000 echo, 6001 tone
                     └─► drachtio ──► app   7000 answers, 7001 rejects
```

## Running it

```bash
docker compose up -d
```

Both phones register within a second or two. Check:

```bash
docker compose exec kamailio kamcmd ul.dump | grep AoR
```

Place a call, answer it, hang up:

```bash
docker compose exec app node ctl.js alice dial sip:bob@siplab
docker compose exec app node ctl.js bob   accept
docker compose exec app node ctl.js alice hangup
```

Watch the signalling while you do it:

```bash
docker compose --profile debug up -d sngrep
docker compose exec sngrep sngrep
```

## What you can dial

| Target | What happens |
| --- | --- |
| `sip:bob@siplab` | Rings the other softphone. Answer it with `ctl.js bob accept`. |
| `sip:6000@siplab` | Asterisk echoes your audio back. Proves media works end to end. |
| `sip:6001@siplab` | Asterisk plays a continuous tone. A call that stays up and makes noise. |
| `sip:6002@siplab` | Early media: Asterisk sends `183 Session Progress` with SDP and plays a tone **without answering**, then gives up. Audio before any `200 OK`. |
| `sip:7000@siplab` | The Node app answers — and sends no audio at all. That is the point. |
| `sip:7001@siplab` | The Node app rejects with `486 Busy Here`. |
| `sip:9999@siplab` | Nothing is registered there; the proxy replies `404`. |

## Why it is built this way

**No published ports.** Everything addresses everything else by service name on
one user-defined bridge. Container-to-container traffic never crosses the Docker
Desktop VM boundary, so UDP behaves identically on Linux, macOS and Windows.
Publishing SIP and RTP ports would drag in Docker Desktop's userland proxy,
which rewrites source addresses and breaks symmetric RTP.

**Not `network_mode: host`.** Docker Desktop has supported it since 4.34, but
only at layer 4, only after you sign in and toggle a setting, and without the
ability to bind host interfaces. It is exactly the kind of "supported" that
produces a broken lab.

**Every tag pinned.** `latest` would break this twice: Kamailio's tracks the 6.0
branch rather than the newest release, and `drachtio/drachtio-server:latest` is
amd64-only, which strands anyone on Apple Silicon.

**Kamailio listens on `eth0` by name, not `0.0.0.0`.** This one is worth
knowing. Kamailio builds its `Via` and `Record-Route` headers from the listen
address, so `0.0.0.0` makes it tell both endpoints to send the ACK, the BYE and
every re-INVITE to `0.0.0.0`. The call appears to connect and then nothing can
ever end it — the answering phone retransmits its `200 OK` on the Timer G
schedule until it gives up. Naming the interface lets Kamailio resolve its real
address at startup, and keeps the file portable across machines where Docker
hands out a different subnet.

**No authentication.** A registrar that challenges would be more realistic and
would double the number of messages in every capture. Security gets its own
treatment in the series; here the priority is a readable trace.

**The softphones have no sound card.** `ausine` generates a 440 Hz tone as the
audio source and `aufile` writes everything received to
`baresip/<phone>/received.wav`. So "did audio arrive" is answered by looking at
a file rather than by listening — which is also how you verify it on a machine
with no speakers, in CI, or over SSH.

```bash
# after a call, on the host
python3 - <<'EOF'
import wave, array
w = wave.open('baresip/alice/received.wav', 'rb')
s = array.array('h'); s.frombytes(w.readframes(w.getnframes()))
print('peak', max(abs(x) for x in s) if s else 0)
EOF
```

Read it **after** hanging up. baresip finalises the wav header on close, so a
file read mid-call reports zero frames no matter what arrived.

**Asterisk has no sound files.** The image ships without the sound packages, so
`Playback()` fails silently and takes the call with it. The dialplan uses
`Echo()` and `Playtones()`, which generate audio with nothing on disk.

## If Asterisk starts rejecting calls from the proxy

Asterisk identifies the proxy by hostname (`match = kamailio` in `pjsip.conf`),
which it resolves to an address. The documentation does not say when that
resolution is refreshed, so if the proxy container ever comes back on a
different address, Asterisk may still be matching the old one and will refuse
its calls.

Every full `down` and `up` tested here has been fine, but if `6000` starts
failing while phone-to-phone still works, that is the thing to suspect:

```bash
docker compose restart asterisk
```

## Resetting

```bash
docker compose --profile debug down -v
rm -f baresip/*/received.wav
docker compose up -d
```

Registrations live in Kamailio's memory only, so a restart forgets every phone
and nothing is ever stale.
