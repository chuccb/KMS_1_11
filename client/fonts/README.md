# Korean text fallback

`kms-cjk.woff2` is a subset of **Noto Sans CJK KR Regular** (Version 2.004),
licensed under SIL Open Font License 1.1; see `OFL.txt`.

Upstream: https://github.com/notofonts/noto-cjk/tree/main/Sans
Original: `Sans/OTF/Korean/NotoSansCJKkr-Regular.otf`.
Copyright 2014–2021 Adobe (font metadata).

Subset repertoire: CP949-decodable characters (the original client's encoding),
Latin-1, and characters in `client/main.js`, `index.html`, `style.css`.
Converted with fontTools `subset`, WOFF2, no hinting, retaining layout features.
No runtime font-download dependency. Browser CSS still prefers installed Dotum/
Gulim-compatible Windows fonts. This fallback prevents missing-glyph squares;
it does **not** claim Windows bitmap-font metrics or pixel-perfect text fidelity.
