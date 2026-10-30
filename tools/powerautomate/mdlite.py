"""Tiny Markdown -> HTML for the setup guide (headings, paragraphs, nested lists, fenced code, tables,
blockquotes, rules, **bold**, `code`). Standard library only."""
import html, re

def inline(t):
    codes = []
    def keep(m): codes.append("<code>" + html.escape(m.group(1), quote=False) + "</code>"); return "\x00%d\x00" % (len(codes) - 1)
    e = html.escape(re.sub(r"`([^`]+)`", keep, t), quote=False)
    e = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", e)
    return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m.group(1))], e)

LIST_RE = re.compile(r"^( *)(\d+\.|[-*]) (.*)$")

def indent_of(l): return len(l) - len(l.lstrip(" "))

def blocks(lines):
    out, i, n = [], 0, len(lines)
    while i < n:
        l = lines[i]
        if not l.strip(): i += 1; continue
        s = l.strip()
        if s.startswith("```"):
            ind = indent_of(l); i += 1; code = []
            while i < n and not lines[i].strip().startswith("```"):
                code.append(lines[i][ind:] if lines[i][:ind].strip() == "" else lines[i].lstrip()); i += 1
            i += 1
            out.append('<pre><code>' + html.escape("\n".join(code), quote=False) + "</code></pre>"); continue
        if re.match(r"^#{1,4} ", s):
            lvl = len(s.split(" ")[0]); txt = s[lvl + 1:]
            sid = re.sub(r"[^a-z0-9]+", "-", txt.lower()).strip("-")
            out.append(f'<h{lvl} id="{sid}">{inline(txt)}</h{lvl}>'); i += 1; continue
        if s == "---": out.append("<hr>"); i += 1; continue
        if s.startswith("|"):
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split(" | ")]); i += 1
            head, body = rows[0], [r for r in rows[1:] if not all(re.match(r"^-+$", c) for c in r)]
            out.append("<table><thead><tr>" + "".join("<th>" + inline(c) + "</th>" for c in head) + "</tr></thead><tbody>" +
                       "".join("<tr>" + "".join("<td>" + inline(c) + "</td>" for c in r) + "</tr>" for r in body) + "</tbody></table>"); continue
        if s.startswith(">"):
            q = []
            while i < n and lines[i].strip().startswith(">"):
                q.append(lines[i].strip()[1:].lstrip()); i += 1
            out.append('<blockquote>' + "".join(blocks(q)) + "</blockquote>"); continue
        m = LIST_RE.match(l)
        if m:
            base, ordered, items = len(m.group(1)), m.group(2)[0].isdigit(), []
            while i < n:
                m = LIST_RE.match(lines[i])
                if not m or len(m.group(1)) != base or m.group(2)[0].isdigit() != ordered: break
                col = base + len(m.group(2)) + 1; body = [m.group(3)]; i += 1
                while i < n and (not lines[i].strip() or indent_of(lines[i]) >= col):
                    body.append(lines[i][col:] if lines[i].strip() else ""); i += 1
                while body and not body[-1].strip(): body.pop()
                inner = blocks(body)
                if len(inner) and inner[0].startswith("<p>") and "\n\n" not in "\n".join(body).strip():
                    inner[0] = inner[0][3:-4]
                items.append("<li>" + "".join(inner) + "</li>")
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>" + "".join(items) + f"</{tag}>"); continue
        para = []
        while i < n and lines[i].strip() and not LIST_RE.match(lines[i]) and not lines[i].strip().startswith(("```", "|", ">", "#")):
            para.append(lines[i].strip()); i += 1
        out.append("<p>" + inline(" ".join(para)) + "</p>")
    return out

CSS = """
:root{--ink:#14202e;--mut:#526276;--line:#d5dce5;--acc:#1f4e79;--bg:#f6f8fb}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:920px;margin:0 auto;padding:28px 32px 60px;background:#fff;min-height:100vh;box-shadow:0 0 0 1px var(--line)}
h1{font-size:1.65rem;margin:0 0 .4em;color:var(--acc);line-height:1.25}h2{font-size:1.3rem;margin:1.6em 0 .5em;color:var(--acc);border-bottom:2px solid var(--line);padding-bottom:.2em}
h3{font-size:1.08rem;margin:1.4em 0 .4em}h4{font-size:1rem;margin:1.2em 0 .3em;color:#2b4a68}
code{font:13px/1.4 Consolas,"Cascadia Mono",monospace;background:#eef2f7;border:1px solid #dde4ee;border-radius:4px;padding:0 4px;word-break:break-word}
pre{background:#0f1b2a;color:#e8f0fa;border-radius:8px;padding:12px 14px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:.6em 0}
pre code{background:none;border:0;color:inherit;padding:0;font-size:13px}
table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:14px}th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}th{background:#eef2f7}
td code{font-size:12px}blockquote{margin:1em 0;padding:8px 14px;border-left:4px solid #c9a227;background:#fff9e6}blockquote p{margin:.3em 0}
hr{border:0;border-top:1px solid var(--line);margin:1.8em 0}li{margin:.25em 0}ol ol{list-style:lower-alpha}
.meta{color:var(--mut);font-size:13px;margin-bottom:1.2em}.toolbar{float:right}.toolbar button{font:inherit;padding:5px 12px;border:1px solid var(--line);background:#fff;border-radius:6px;cursor:pointer}
@media print{body{background:#fff;font-size:11pt}main{box-shadow:none;max-width:none;padding:0}.toolbar{display:none}pre{background:#f3f5f8;color:#000;border:1px solid #ccc}
h2{break-after:avoid}h3,h4{break-after:avoid}pre,table,blockquote{break-inside:avoid}a{color:inherit}}
"""

def render(md, title):
    body = "".join(blocks(md.splitlines()))
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f"<title>{html.escape(title)}</title>\n<style>{CSS}</style>\n</head>\n<body>\n<main>\n"
            '<div class="toolbar"><button type="button" onclick="window.print()">Print / PDF</button></div>\n'
            f"{body}\n</main>\n</body>\n</html>\n")
