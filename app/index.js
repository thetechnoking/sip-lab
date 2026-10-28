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

  // 7NNN -- reply with SIP status NNN, exactly. 7486 answers 486, 7603
  // answers 603. No translation layer, so whatever arrives at the far end is
  // precisely what was sent.
  const asStatus = /^7(\d{3})$/.exec(to);
  if (asStatus) {
    const status = parseInt(asStatus[1], 10);
    if (status >= 400 && status <= 699) {
      console.log(`  replying ${status} as asked`);
      return res.send(status);
    }
  }

  if (to === '7001') {
    // A deliberate rejection, so there is a non-2xx final response to look at
    // in a capture -- and an ACK that is part of the INVITE transaction.
    console.log('  replying 486 Busy Here');
    return res.send(486);
  }

  if (to === '7002') {
    // 603 Decline. Globally final: it means stop, not try elsewhere. Compare
    // with the 486 above, which only describes this one device.
    console.log('  replying 603 Decline');
    return res.send(603);
  }

  if (to === '7004') {
    // Glare on demand.
    //
    // Answers normally. Then, when the caller sends a re-INVITE, holds the
    // answer open for two seconds and fires its own re-INVITE half a second
    // into that pause. The caller therefore has a transaction outstanding
    // when ours lands, and replies 491 Request Pending.
    //
    // Creating the window this way is the whole trick: the natural window is
    // one network hop wide, which is far too narrow to aim at.
    const HOLD_ANSWER_MS = 2000;
    const COLLIDE_AFTER_MS = 500;

    console.log('  7004: answering; will stall the next re-INVITE to force glare');
    try {
      const localAddress = req.socket.localAddress || '127.0.0.1';
      const dialog = await srf.createUAS(req, res, {
        localSdp: silentSdp(localAddress),
      });

      dialog.on('modify', async (modReq, modRes) => {
        console.log('  7004: re-INVITE arrived — stalling my answer for ' +
                    HOLD_ANSWER_MS + ' ms');

        setTimeout(async () => {
          console.log('  7004: sending my own re-INVITE into that window');
          try {
            await dialog.modify(silentSdp(localAddress));
            console.log('  7004: mine succeeded (no glare this time)');
          } catch (err) {
            console.log('  7004: mine got ' + (err.status || err.message));
          }
        }, COLLIDE_AFTER_MS);

        setTimeout(() => {
          console.log('  7004: now answering the caller\'s re-INVITE');
          modRes.send(200, { body: silentSdp(localAddress) });
        }, HOLD_ANSWER_MS);
      });

      setTimeout(() => dialog && dialog.connected && dialog.destroy(), 25_000);
    } catch (err) {
      console.log('  7004: could not answer: ' + (err.status || err.message));
    }
    return;
  }

  if (to === '7003') {
    // Answers exactly three seconds after the INVITE arrives, so a CANCEL sent
    // at the same moment collides with the 200 OK. Part four is about what
    // happens next, and it needs the collision to be reproducible rather than
    // a once-a-month surprise.
    //
    // Ring first, so the caller is allowed to send a CANCEL at all: RFC 3261
    // §9.1 says a CANCEL must not be sent until a provisional response has
    // been received.
    console.log('  7003: ringing, will answer in 3s');
    res.send(180);

    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      const localAddress = req.socket.localAddress || '127.0.0.1';
      const dialog = await srf.createUAS(req, res, {
        localSdp: silentSdp(localAddress),
      });
      console.log('  7003: answered — if a CANCEL was in flight, it lost');
      setTimeout(() => dialog && dialog.connected && dialog.destroy(), 15_000);
    } catch (err) {
      if (err.status === 487) {
        console.log('  7003: cancelled before answer — the CANCEL won');
      } else {
        console.error('  7003: could not answer:', err.message);
      }
    }
    return;
  }

  try {
    const localAddress = req.socket.localAddress || '127.0.0.1';
    const dialog = await srf.createUAS(req, res, {
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
