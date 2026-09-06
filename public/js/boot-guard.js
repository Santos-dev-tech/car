/**
 * MotoKE is a served application. Opened straight from disk it is a blank, unstyled
 * shell, because /css, /js and /api cannot resolve outside http(s).
 *
 * This file is loaded with a RELATIVE path so it runs in both situations: over http it
 * satisfies the Content-Security-Policy (script-src 'self'), and over file:// it still
 * resolves next to the HTML and can explain what went wrong.
 */
(function () {
  if (location.protocol === 'http:' || location.protocol === 'https:') return;

  var admin = /admin/i.test(location.pathname);
  var target = admin ? 'http://localhost:4000/admin' : 'http://localhost:4000/';
  var file = admin ? 'admin.html' : 'index.html';
  var extra = admin
    ? 'Sign in with <code>admin@motoke.demo</code> / <code>admin123</code>'
    : 'Staff console: <code>http://localhost:4000/admin</code>';

  document.documentElement.innerHTML =
    '<head><meta charset="utf-8"><title>Start the MotoKE server</title></head>' +
    '<body style="margin:0;background:#0b1120;color:#e8edf7;font:15px/1.6 system-ui,Segoe UI,sans-serif">' +
    '<div style="max-width:620px;margin:12vh auto;padding:32px;background:#16203a;border:1px solid #263352;border-radius:18px">' +
    '<h1 style="margin:0 0 6px;font-size:1.5rem">This page needs the MotoKE server</h1>' +
    '<p style="color:#97a3bd">You have opened <code>' + file + '</code> directly from the folder. ' +
    'MotoKE is a full application — the catalogue, the finance engine and the admin console all come ' +
    'from a local server, so the file on its own is an empty shell.</p>' +
    '<p style="color:#97a3bd;margin-bottom:6px"><b style="color:#e8edf7">To run it:</b> double-click ' +
    '<code>START.bat</code> in the <code>motoke</code> folder, then open:</p>' +
    '<p><a href="' + target + '" style="display:inline-block;background:#c8102e;color:#fff;padding:11px 20px;' +
    'border-radius:10px;text-decoration:none;font-weight:600">' + target + '</a></p>' +
    '<p style="color:#6b7897;font-size:.86rem;margin-bottom:0">' + extra + '</p>' +
    '</div></body>';
})();
