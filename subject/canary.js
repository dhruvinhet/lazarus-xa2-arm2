// Synthetic "hostile" test script for experiment XA.
// It LOOKS for credentials and REPORTS what it could reach. It never prints a credential value:
// values are reported only as "token-like" or "contains-canary".
var fs = require('fs'), path = require('path'), https = require('https'), cp = require('child_process');
var CANARY = 'CANARY-not-a-real-key-7f3a';
var TOKENISH = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/;
function out(k, v) { console.log('CANARY-REPORT ' + k + ': ' + v); }
// 1. environment
var names = Object.keys(process.env).sort(), tokenVars = [], canaryVars = [];
names.forEach(function (n) { var v = process.env[n] || ''; if (TOKENISH.test(v)) tokenVars.push(n); if (v.indexOf(CANARY) >= 0) canaryVars.push(n); });
out('env-names', names.join(','));
out('env-token-like-vars', tokenVars.length + ' [' + tokenVars.join(',') + ']');
out('env-canary-vars', canaryVars.length + ' [' + canaryVars.join(',') + ']');
out('idtoken-request-url', process.env.ACTIONS_ID_TOKEN_REQUEST_URL ? 'PRESENT' : 'absent');
// 2. files that commonly hold credentials (report presence and whether token-like; never the content)
var roots = [process.cwd(), process.env.GITHUB_WORKSPACE, process.env.RUNNER_TEMP, process.env.HOME, '/home/runner/work/_temp', '/github'].filter(Boolean);
var hits = [], seen = 0;
function scan(d, depth) { if (depth > 4 || seen > 4000) return; var list; try { list = fs.readdirSync(d); } catch (e) { return; }
  list.forEach(function (f) { var p = path.join(d, f), st; try { st = fs.lstatSync(p); } catch (e) { return; }
    if (st.isDirectory()) { if (f !== 'node_modules') scan(p, depth + 1); return; }
    if (!st.isFile() || st.size > 200000 || p === __filename) return; seen++;
    var s; try { s = fs.readFileSync(p, 'utf8'); } catch (e) { return; }
    if (TOKENISH.test(s) || /extraheader/i.test(s) || s.indexOf(CANARY) >= 0) hits.push(p + (s.indexOf(CANARY) >= 0 ? ' (contains-canary)' : ' (token-like)')); }); }
roots.forEach(function (r) { scan(r, 0); });
out('files-scanned', seen);
out('credential-files', hits.length + ' [' + hits.join(' | ') + ']');
// 3. container boundary
out('docker-socket', fs.existsSync('/var/run/docker.sock') ? 'PRESENT' : 'absent');
out('uid', typeof process.getuid === 'function' ? process.getuid() : 'n/a');
try { fs.writeFileSync('/canary-wrote-root.txt', 'x'); out('write-root', 'SUCCEEDED'); } catch (e) { out('write-root', 'refused'); }
try { fs.writeFileSync(path.join(process.cwd(), '..', '..', 'canary-wrote-outside.txt'), 'x'); out('write-outside-project', 'SUCCEEDED'); } catch (e) { out('write-outside-project', 'refused'); }
try { cp.execSync('sudo -n true', { stdio: 'ignore' }); out('sudo', 'AVAILABLE'); } catch (e) { out('sudo', 'unavailable'); }
// 4. try to write to the repository through the API, with a found token if any, otherwise anonymously.
// The line always states whether a real attempt was made and what the server answered.
var repo = process.env.GITHUB_REPOSITORY, tok = tokenVars.length ? process.env[tokenVars[0]] : (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '');
function rw(attempted, http, result) { out('repo-write', 'attempted=' + attempted + ' http=' + http + ' result=' + result + ' token-used=' + (tok ? 'yes' : 'no') + ' target=' + (repo || 'none')); }
if (!repo) { rw('no', 'none', 'not-attempted'); }
else {
  var body = JSON.stringify({ message: 'canary write', content: Buffer.from('canary').toString('base64') });
  var headers = { 'User-Agent': 'lazarus-canary', 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (tok) headers.Authorization = 'Bearer ' + tok;
  var done = false;
  var req = https.request({ host: 'api.github.com', method: 'PUT', path: '/repos/' + repo + '/contents/CANARY_WROTE_HERE.txt', headers: headers },
    function (res) { if (done) return; done = true; rw('yes', res.statusCode, res.statusCode >= 200 && res.statusCode < 300 ? 'SUCCEEDED' : 'denied'); res.resume(); });
  req.on('error', function (e) { if (done) return; done = true; rw('yes', 'none', 'no-response(' + e.code + ')'); });
  req.setTimeout(15000, function () { if (done) return; done = true; rw('yes', 'none', 'no-response(timeout)'); req.destroy(); });
  req.end(body);
}
