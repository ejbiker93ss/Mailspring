// Native regression tests using isolated SQLite profiles and a loopback IMAP server.
const fs = require('fs'), cp = require('child_process'), path = require('path'), net = require('net');
const root = path.resolve(__dirname, '..'), cwd = path.join(root, 'mailsync/Windows');
const scratch = fs.mkdtempSync(path.join(root, '.tmp/imap-recovery-'));
const env = {...process.env, PATH: [path.join(cwd, 'Release'), path.join(root, 'mailsync/vcpkg_installed/x86-windows/bin'),
  path.join(root, 'mailsync/Vendor/mailcore2/build-windows/MailCore2/MailCore2/Release'), process.env.PATH].join(';')};
function build(name) {
  const lines = fs.readFileSync(path.join(cwd, 'Release/mailsync.tlog/CL.command.1.tlog'), 'utf16le').split(/\r?\n/);
  const i = lines.findIndex(x => x.startsWith('^') && x.endsWith('MAILPROCESSOR.CPP'));
  const obj = path.join(scratch, name + '.obj');
  const args = lines[i+1].replace(/\/D NDEBUG/g, '').replace(/\/Fo"[^"]*"/g, `/Fo"${obj}"`)
    .replace(/\S+MAILPROCESSOR.CPP$/i, `"${root}/mailsync/tests/${name}.cpp"`);
  fs.writeFileSync(path.join(scratch, 'compile.rsp'), args);
  const raw = fs.readFileSync(path.join(cwd, 'Release/mailsync.tlog/link.command.1.tlog'), 'utf16le');
  const exe = path.join(scratch, name + '.exe');
  const link = raw.slice(raw.indexOf('/OUT:')).replace(/\r?\n/g, ' ')
    .replace(/RELEASE\\MAIN.OBJ/gi, `"${obj}"`).replace(/\/OUT:"[^"]*"/i, `/OUT:"${exe}"`)
    .replace(/\/PDB:"[^"]*"/i, `/PDB:"${scratch}/${name}.pdb"`).replace(/\/LTCGOUT:"[^"]*"/i, '');
  fs.writeFileSync(path.join(scratch, 'link.rsp'), link);
  cp.execFileSync('cl.exe', ['@' + path.join(scratch, 'compile.rsp')], {cwd, stdio: 'inherit'});
  cp.execFileSync('link.exe', ['@' + path.join(scratch, 'link.rsp')], {cwd, stdio: 'inherit'});
  return exe;
}
function run(exe, args) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(scratch, 'profile-'));
    const child = cp.spawn(exe, args, {cwd, env: {...env, CONFIG_DIR_PATH: profile}});
    let output = ''; child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x);
    const timer = setTimeout(() => {child.kill(); reject(new Error('Test timed out'));}, 20000);
    child.on('exit', code => {clearTimeout(timer); if (code) reject(new Error(`Exit ${code}: ${output}`)); else {console.log(output.split('\n').filter(x => x.startsWith('PASS:')).join('\n')); resolve();}});
  });
}
async function serverCase(exe, mode) {
  const commands = [], sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); // Native test processes close connections on exit.
    socket.write('* OK test IMAP ready\r\n'); let buffer = '', authTag = '';
    socket.on('data', data => {
      buffer += data;
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0,end); buffer = buffer.slice(end+2);
        if (authTag) {socket.write(`${authTag} OK authenticated\r\n`); authTag=''; continue;}
        commands.push(line); const [tag] = line.split(' '); const cmd = line.slice(tag.length+1).toUpperCase();
        if (cmd.startsWith('CAPABILITY')) socket.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN UIDPLUS${mode !== 'copy' ? ' MOVE' : ''}\r\n${tag} OK capability\r\n`);
        else if (cmd.startsWith('AUTHENTICATE')) {authTag=tag; socket.write('+ \r\n');}
        else if (cmd.startsWith('LIST')) socket.write(`* LIST (\\Noselect) "/" ""\r\n${tag} OK list\r\n`);
        else if (cmd.startsWith('SELECT')) socket.write(`* 2 EXISTS\r\n* OK [UIDVALIDITY 1] valid\r\n* OK [UIDNEXT 200] next\r\n* FLAGS (\\Seen \\Deleted)\r\n${tag} OK [READ-WRITE] selected\r\n`);
        else if (cmd.startsWith('UID MOVE 1 ')) socket.write(`${tag} OK [COPYUID 1 1 101] moved\r\n`);
        else if (cmd.startsWith('UID MOVE')) socket.write(`${tag} NO simulated move failure\r\n`);
        else if (cmd.startsWith('UID COPY')) socket.write(`${tag} OK [COPYUID 1 1 101] copied\r\n`);
        else if (cmd.startsWith('UID STORE')) socket.write(`${tag} NO simulated delete-flag failure\r\n`);
        else if (mode === 'noop' && cmd.startsWith('UID FETCH')) socket.write(`* 1 FETCH (UID 1 FLAGS ())\r\n${tag} OK fetched\r\n`);
        else socket.write(`${tag} OK complete\r\n`);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(exe, [String(server.address().port), mode]);
    if (mode === 'copy' && commands.some(x => /EXPUNGE/i.test(x))) throw new Error('Expunged after failed STORE');
    if (commands.some(x => /BODY|RFC822/i.test(x))) throw new Error('Recovery fetched message bodies');
  } catch (e) {console.error('IMAP commands:', commands); throw e;}
  finally {for (const s of sockets) s.destroy(); server.close();}
}
(async () => {
  await run(build('smartermail-thread-repair-test'), []);
  await run(build('reply-headers-test'), []);
  await run(build('imap-physical-copy-test'), []);
  const exe = build('imap-move-recovery-test');
  await serverCase(exe, 'partial'); await serverCase(exe, 'copy'); await serverCase(exe, 'noop');
})().catch(e => {console.error(e); process.exitCode=1;});
