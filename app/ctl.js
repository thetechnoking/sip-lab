// Drive a softphone from the command line.
//
//   docker compose exec app node ctl.js alice dial sip:bob@siplab
//   docker compose exec app node ctl.js alice hangup
//   docker compose exec app node ctl.js bob   accept
//   docker compose exec app node ctl.js alice listcalls
//
// baresip's ctrl_tcp module speaks netstrings: a decimal byte count, a colon,
// the payload, then a comma. The payload is JSON. That is the whole protocol.
//
// Scripting the phones rather than typing into them is what makes a capture
// reproducible -- you can run the same call twice and diff the traces.

const net = require('net');

const [phone, command, ...rest] = process.argv.slice(2);
if (!phone || !command) {
  console.error('usage: node ctl.js <alice|bob> <command> [params]');
  process.exit(2);
}

const payload = JSON.stringify({
  command,
  params: rest.join(' '),
  token: String(Date.now()),
});
const netstring = `${Buffer.byteLength(payload)}:${payload},`;

const sock = net.createConnection({ host: phone, port: 4444 }, () => {
  sock.write(netstring);
});

let buf = '';
sock.on('data', (chunk) => {
  buf += chunk.toString();
  // Responses are netstrings too. Pull out each complete one and print the
  // interesting field rather than the envelope.
  let m;
  while ((m = buf.match(/^(\d+):/))) {
    const len = parseInt(m[1], 10);
    const start = m[0].length;
    if (buf.length < start + len + 1) break;
    const body = buf.slice(start, start + len);
    buf = buf.slice(start + len + 1);
    try {
      const msg = JSON.parse(body);
      if (msg.response !== undefined) {
        console.log(msg.data ? String(msg.data).trim() : `ok (${command})`);
        sock.end();
      } else if (msg.event) {
        console.log(`event: ${msg.type || ''} ${msg.param || ''}`.trim());
      }
    } catch {
      console.log(body);
    }
  }
});

sock.on('error', (err) => {
  console.error(`cannot reach ${phone}:4444 — ${err.message}`);
  process.exit(1);
});

// ctrl_tcp keeps the socket open for events; we only want the reply.
setTimeout(() => sock.end(), 1500);
