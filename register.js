// A REGISTER, built by hand.
//
// No framework, no SIP stack doing it for you -- just enough code to show that
// a SIP message is text you can type, sent over a UDP socket. Run this and
// watch it in sngrep next to a real phone's REGISTER; they are the same shape.
//
// Uses the `sip` package, which is pure JavaScript with no native build step.
// Be aware it is old: the npm release is from 2019 and the project is not
// actively maintained. It is the right tool for exactly this one demonstration
// and the wrong tool to build anything on -- the rest of the series uses
// drachtio.
//
//   npm install sip
//   node register.js

const sip = require('sip');

const PROXY = process.env.PROXY || '127.0.0.1';
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '5060', 10);
const USER = process.env.USER_ID || '1003';
const LOCAL_PORT = parseInt(process.env.LOCAL_PORT || '5078', 10);

// `sip.start` opens the socket and hands us anything that arrives unsolicited.
// A REGISTER's response comes back through the callback below instead, so this
// handler exists only to answer the OPTIONS pings a proxy may send.
sip.start({ port: LOCAL_PORT }, (request) => {
  console.log(`<-- ${request.method}`);
  sip.send(sip.makeResponse(request, 200, 'OK'));
});

// Every field here has a job. Read it alongside the capture:
//
//   Call-ID   identifies this registration over time; reuse it when refreshing
//   CSeq      increments per request within that Call-ID
//   From tag  our half of what will become a dialog identifier
//   Contact   where we are reachable -- this is what the registrar stores
//   Expires   how long the registrar should keep it
const callId = `${Math.random().toString(36).slice(2)}@lab`;
const fromTag = Math.random().toString(36).slice(2, 10);

const register = {
  method: 'REGISTER',
  uri: `sip:${PROXY}:${PROXY_PORT}`,
  version: '2.0',
  headers: {
    to: { uri: `sip:${USER}@siplab` },
    from: { uri: `sip:${USER}@siplab`, params: { tag: fromTag } },
    'call-id': callId,
    cseq: { method: 'REGISTER', seq: 1 },
    contact: [{ uri: `sip:${USER}@${localAddress()}:${LOCAL_PORT}` }],
    expires: 120,
    'max-forwards': 70,
    'user-agent': 'voipbuddies-lab/1.0',
    // `sip` fills in Via, including the branch with its z9hG4bK cookie.
  },
};

console.log(`--> REGISTER ${USER} to ${PROXY}:${PROXY_PORT}\n`);
console.log(sip.stringify(register));

sip.send(register, (response) => {
  console.log(`<-- ${response.status} ${response.reason}\n`);
  console.log(sip.stringify(response));

  if (response.status === 401 || response.status === 407) {
    // The lab proxy does not challenge, so this is informational: a real
    // registrar answers the first REGISTER with a challenge and expects the
    // whole thing again carrying an Authorization header. Two transactions,
    // one registration.
    console.log('\nregistrar wants authentication -- two round trips, not one');
  }
  if (response.status === 200) {
    console.log('\nregistered. check the proxy: kamcmd ul.dump');
  }
  setTimeout(() => process.exit(0), 250);
});

// The address a UDP socket would use to reach the proxy. Getting this right
// matters: whatever goes in Contact is where the registrar will send calls, so
// a wrong value here is the classic "registers fine, never rings" bug.
function localAddress() {
  const os = require('os');
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  }
  return '127.0.0.1';
}
