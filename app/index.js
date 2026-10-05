// The Node leg of the lab.
//
// drachtio-srf gives you SIP signalling and nothing else -- no media. That is
// not a limitation to work around here, it is the demonstration: call 7000 and
// the call will connect perfectly and be completely silent, because answering
// a call and carrying audio are two different jobs and this program only does
// one of them.
//
// Extension 7000 answers. 7001 rejects with 486 so part 3 has something to
// point at.

const Srf = require('drachtio-srf');
const srf = new Srf();

srf.connect({
  host: process.env.DRACHTIO_HOST || 'drachtio',
  port: parseInt(process.env.DRACHTIO_PORT || '9022', 10),
  secret: process.env.DRACHTIO_SECRET || 'cymru',
});

srf.on('connect', (err, hostport) => {
  if (err) return console.error('drachtio connect failed:', err);
  console.log(`connected to drachtio at ${hostport}`);
});
srf.on('error', (err) => console.error('drachtio error:', err));

// An SDP answer that is syntactically valid and points at a port where nothing
// is listening. The far end will dutifully send RTP into the void.
//
// `connectionAddress` is filled in at answer time with whatever address this
// container has, because we cannot know it when writing the file.
function silentSdp(address) {
  return [
    'v=0',
    `o=- ${Date.now()} ${Date.now()} IN IP4 ${address}`,
    's=-',
    `c=IN IP4 ${address}`,
    't=0 0',
    'm=audio 40000 RTP/AVP 0 8',
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:8 PCMA/8000',
    'a=sendrecv',
    '',
  ].join('\r\n');
}

srf.invite(async (req, res) => {
  const to = req.calledNumber;
  const from = req.callingNumber;
  console.log(`INVITE  ${from} -> ${to}   Call-ID ${req.get('Call-ID')}`);

  if (to === '7001') {
    // A deliberate rejection, so there is a non-2xx final response to look at
    // in a capture -- and an ACK that is part of the INVITE transaction.
    console.log('  replying 486 Busy Here');
    return res.send(486);
  }

  try {
    const localAddress = req.socket.localAddress || '127.0.0.1';
    const { dialog } = await srf.createUAS(req, res, {
      localSdp: silentSdp(localAddress),
    });

    console.log(`  answered. dialog is up, and it is silent on purpose.`);
    console.log(`  Call-ID ${dialog.sip.callId}`);

    dialog.on('destroy', () => {
      console.log(`  far end sent BYE, dialog gone`);
    });

    // Hang up after 30 seconds so a forgotten call does not sit there.
    setTimeout(() => {
      if (dialog.connected) {
        console.log('  30s elapsed, sending BYE');
        dialog.destroy();
      }
    }, 30_000);
  } catch (err) {
    // A caller who gives up before we answer lands here: drachtio surfaces the
    // CANCEL as a rejected promise. Part 4 of the series is entirely about
    // this moment.
    if (err.status === 487) {
      console.log('  caller cancelled before answer (487)');
    } else {
      console.error('  failed to answer:', err.message);
    }
  }
});

console.log('lab app listening for INVITEs on 7000 (answer) and 7001 (486)');
