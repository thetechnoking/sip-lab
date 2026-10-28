// Stand in the CANCEL race on purpose.
//
//   docker compose exec app node race.js 7003 2900
//
// Places a call and sends CANCEL after exactly N milliseconds, from inside the
// lab network, so the timing is controlled to the millisecond rather than to
// however long `docker compose exec` happens to take.
//
// 7003 answers at exactly 3000 ms. Cancel at 2900 and the CANCEL wins; cancel
// at 3100 and the answer wins; cancel near 3000 and you are standing in the
// window where both are in flight and neither side is wrong.

const Srf = require('drachtio-srf');
const srf = new Srf();

const target = process.argv[2] || '7003';
const cancelAt = parseInt(process.argv[3] || '2900', 10);

srf.connect({
  host: process.env.DRACHTIO_HOST || 'drachtio',
  port: parseInt(process.env.DRACHTIO_PORT || '9022', 10),
  secret: process.env.DRACHTIO_SECRET || 'cymru',
});

const SDP = [
  'v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-', 'c=IN IP4 127.0.0.1', 't=0 0',
  'm=audio 41000 RTP/AVP 0', 'a=rtpmap:0 PCMU/8000', '',
].join('\r\n');

srf.on('connect', async () => {
  const started = Date.now();
  const ms = () => String(Date.now() - started).padStart(5) + ' ms';

  console.log(`\ncalling ${target}, cancelling after ${cancelAt} ms\n`);

  let inviteReq = null;
  let cancelled = false;

  try {
    const dialog = await srf.createUAC(`sip:${target}@siplab`, {
      localSdp: SDP,
      proxy: 'sip:kamailio:5060',
      headers: { From: '<sip:racer@siplab>' },
    }, {
      // Handed the outgoing INVITE as soon as it exists, which is what makes
      // precise cancellation possible.
      cbRequest: (err, req) => {
        inviteReq = req;
        console.log(`${ms()}  INVITE sent`);
        setTimeout(() => {
          if (inviteReq && !cancelled) {
            cancelled = true;
            console.log(`${ms()}  sending CANCEL`);
            inviteReq.cancel();
          }
        }, cancelAt);
      },
      cbProvisional: (res) => console.log(`${ms()}  <- ${res.status} ${res.reason}`),
    });

    // Getting here means the 200 arrived and was acknowledged: the answer won.
    console.log(`${ms()}  <- 200 OK — ANSWER WON`);
    console.log(`${ms()}  the call is up and the caller did not want it`);
    dialog.destroy();
    console.log(`${ms()}  sent BYE to clean up the call nobody wanted`);
    finish('ANSWER WON');
  } catch (err) {
    if (err.status === 487) {
      console.log(`${ms()}  <- 487 Request Terminated — CANCEL WON`);
      finish('CANCEL WON');
    } else {
      console.log(`${ms()}  failed: ${err.status || ''} ${err.message}`);
      finish('ERROR');
    }
  }
});

function finish(verdict) {
  console.log(`\nRESULT: ${verdict}\n`);
  setTimeout(() => process.exit(0), 400);
}

srf.on('error', (err) => {
  console.error('drachtio error:', err.message);
  process.exit(1);
});
