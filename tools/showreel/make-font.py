#!/usr/bin/env python3
"""Subset system-installed Inter (OTF) to the glyphs the showreel uses and emit
base64 WOFF (zlib) @font-face CSS to src/font.css. No network needed."""
import base64, io, sys, pathlib
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = pathlib.Path("/usr/share/fonts/opentype/inter")
OUT = pathlib.Path(__file__).parent / "src" / "font.css"
WEIGHTS = {400: "Regular", 500: "Medium", 600: "SemiBold", 800: "ExtraBold"}
TEXT = ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        " .,:;!?'\"()[]/\\-_+=*&%#@<>|~—–→←✓•·…")
css = []
for w, name in WEIGHTS.items():
    f = SRC / f"Inter-{name}.otf"
    opts = subset.Options()
    opts.flavor = "woff"
    opts.layout_features = ["kern", "liga", "calt", "tnum", "ss01", "cv11", "case"]
    opts.notdef_outline = True
    opts.name_IDs = [1, 2]
    font = TTFont(str(f))
    sub = subset.Subsetter(opts)
    sub.populate(text=TEXT)
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff"
    font.save(buf)
    b64 = base64.b64encode(buf.getvalue()).decode()
    css.append("@font-face{font-family:'Inter';font-weight:%d;font-style:normal;"
               "src:url(data:font/woff;base64,%s) format('woff');}" % (w, b64))
    print(name, len(buf.getvalue()), "bytes", file=sys.stderr)
OUT.write_text("\n".join(css))
print("wrote", OUT, OUT.stat().st_size, file=sys.stderr)
