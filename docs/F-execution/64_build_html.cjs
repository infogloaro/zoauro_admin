// Builds 64_Demo_Presenter_Guide.html from 64_Demo_Presenter_Guide.md: the Markdown is embedded as is and rendered in the
// browser (marked + mermaid from jsDelivr), so the .md stays the only source. Run after editing the guide:
//   node docs/F-execution/64_build_html.cjs
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const md = fs.readFileSync(path.join(dir, '64_Demo_Presenter_Guide.md'), 'utf8');
if (/<\/script/i.test(md)) throw new Error('the guide must not contain a closing script tag');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZOAURO Demo Guide</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#f7f5f2;--paper:#ffffff;--ink:#1c1917;--muted:#57534e;--line:#e7e5e4;--brand:#c2410c;--brand-soft:#fff1e8;--say:#fff7ed;--say-line:#fb923c;--code:#f5f5f4}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#141210;--paper:#1c1917;--ink:#f5f5f4;--muted:#a8a29e;--line:#2e2a27;--brand:#fb923c;--brand-soft:#2a1d14;--say:#24190f;--say-line:#ea580c;--code:#292524}}
:root[data-theme="dark"]{--bg:#141210;--paper:#1c1917;--ink:#f5f5f4;--muted:#a8a29e;--line:#2e2a27;--brand:#fb923c;--brand-soft:#2a1d14;--say:#24190f;--say-line:#ea580c;--code:#292524}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Public Sans",system-ui,sans-serif}
.wrap{display:grid;grid-template-columns:260px minmax(0,1fr);gap:32px;max-width:1240px;margin:0 auto;padding:24px 16px}
nav{position:sticky;top:16px;align-self:start;max-height:calc(100vh - 32px);overflow:auto;font-size:13px}
nav a{display:block;padding:4px 8px;border-radius:6px;color:var(--muted);text-decoration:none}
nav a:hover{background:var(--brand-soft);color:var(--ink)}
main{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:32px 40px;min-width:0}
h1{font-size:28px;line-height:1.2;margin:0 0 12px;text-wrap:balance}
h2{font-size:21px;margin:40px 0 12px;padding-top:12px;border-top:1px solid var(--line);color:var(--brand)}
h3{font-size:16px;margin:24px 0 8px}
p,li{max-width:78ch}
a{color:var(--brand)}
code{font:13px "JetBrains Mono",monospace;background:var(--code);padding:1px 5px;border-radius:4px}
blockquote{margin:12px 0;padding:12px 16px;background:var(--say);border-left:4px solid var(--say-line);border-radius:0 8px 8px 0}
blockquote p{margin:0 0 6px}blockquote p:last-child{margin:0}
blockquote::before{content:"SAY";display:block;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--say-line);margin-bottom:4px}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--brand-soft)}
.mermaid{margin:16px 0;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);overflow-x:auto;text-align:center}
hr{display:none}
.bar{display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px}
.bar button{font:inherit;font-size:13px;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink);cursor:pointer}
@media (max-width:900px){.wrap{grid-template-columns:1fr}nav{position:static;max-height:none}main{padding:20px 16px}}
@media print{nav,.bar{display:none}.wrap{display:block;max-width:none;padding:0}main{border:0;padding:0}h2{break-before:page}}
</style>
</head>
<body>
<div class="wrap">
<nav id="toc" aria-label="Contents"></nav>
<main>
<div class="bar"><button type="button" id="theme">Light / dark</button><button type="button" onclick="window.print()">Print</button></div>
<article id="doc"><p>Loading the guide… (needs an internet connection for the page layout and diagrams)</p></article>
</main>
</div>
<script type="text/markdown" id="src">
${md}
</script>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<script>
(function () {
  var root = document.documentElement;
  document.getElementById('theme').addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
    render();
  });
  var src = document.getElementById('src').textContent;
  function render() {
    var doc = document.getElementById('doc');
    doc.innerHTML = marked.parse(src);
    // the SAY card carries its own label, so a bare "Say:" line before it is dropped
    doc.querySelectorAll('p').forEach(function (p) {
      if (p.textContent.trim() === 'Say:' && p.nextElementSibling && p.nextElementSibling.tagName === 'BLOCKQUOTE') p.remove();
    });
    var toc = document.getElementById('toc');
    toc.innerHTML = '';
    doc.querySelectorAll('h2').forEach(function (h, i) {
      h.id = 'p' + i;
      var a = document.createElement('a');
      a.href = '#p' + i; a.textContent = h.textContent;
      toc.appendChild(a);
    });
    doc.querySelectorAll('pre > code.language-mermaid').forEach(function (c) {
      var d = document.createElement('div');
      d.className = 'mermaid'; d.textContent = c.textContent;
      c.parentNode.replaceWith(d);
    });
    var dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
    mermaid.run({ querySelector: '.mermaid' });
  }
  render();
})();
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(dir, '64_Demo_Presenter_Guide.html'), html);
console.log('wrote 64_Demo_Presenter_Guide.html', html.length, 'bytes');
