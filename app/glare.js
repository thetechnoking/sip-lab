// Cause glare on purpose.
//
//   docker compose exec app node glare.js 3000
//
// Calls 7004, which answers and then sends its own re-INVITE at a known
// moment. This side re-INVITEs at the same moment. Both ends then have a
// request outstanding when the other's arrives, which is exactly the
// situation 491 Request Pending exists for.

const Srf = require('drachtio-srf');
const srf = new Srf();

const at = parseInt(process.argv[2] || '3000', 10);

srf.connect({
  host: process.env.DRACHTIO_HOST || 'drachtio',
  port: parseInt(process.env.DRACHTIO_PORT || '9022', 10),
  secret: process.env.DRACHTIO_SECRET || 'cymru',
});

const sdp = (port) => [
  'v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-', 'c=IN IP4 127.0.0.1', 't=0 0',
  `m=audio ${port} RTP/AVP 0`, 'a=rtpmap:0 PCMU/8000', '',
].join('\r\n');

srf.on('connect', async () => {
  const t0 = Date.now();
  const ms = () => String(Date.now() - t0).padStart(5) + ' ms';

  console.log(`\nboth sides will re-INVITE at ${at} ms\n`);

  let dialog;
  try {
    dialog = await srf.createUAC('sip:7004@siplab', {
      localSdp: sdp(41000),
      proxy: 'sip:kamailio:5060',
      headers: { From: '<sip:glare@siplab>', 'X-Reinvite-At': String(at) },
    });
    console.log(`${ms()}  call established`);
  } catch (err) {
    console.log(`${ms()}  could not establish: ${err.status || err.message}`);
    return finish('SETUP FAILED');
  }

  setTimeout(async () => {
    console.log(`${ms()}  sending my re-INVITE now`);
    try {
      await dialog.modify(sdp(41002));
      console.log(`${ms()}  my re-INVITE succeeded — I won`);
      finish('CALLER WON');
    } catch (err) {
      const status = err.status || err.message;
      console.log(`${ms()}  my re-INVITE got ${status}`);
      if (status === 491) {
        console.log(`${ms()}  491 Request Pending — the far end had one outstanding too`);
        finish('GLARE — caller got 491');
      } else {
        finish(`other: ${status}`);
      }
    }
  }, at);

  setTimeout(() => { try { dialog.destroy(); } catch {} }, at + 6000);
});

function finish(verdict) {
  console.log(`\nRESULT: ${verdict}\n`);
  setTimeout(() => process.exit(0), 2500);
}

srf.on('error', (e) => { console.error('drachtio:', e.message); process.exit(1); });
