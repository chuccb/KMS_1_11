"""Read a WZ v1 archive and resolve its images to real byte ranges.

``wz1`` reads the directory tree; ``wzimg`` reads the value codec.  This module
sits on top and answers the question that used to be wrong: *where is image X?*

Every blob is verified by parsing to its declared size and requiring a valid
image root. All 1,056 images in the checked-in Data.wz resolve at their declared
contiguous offsets; all checksums match, with zero unlisted objects. The old
172,999-byte discrepancy was a directory-reader bug: tag-2 name references must
inherit the target entry's kind, including the four Map/Tile entries.
Scanning is retained as a diagnostic fallback for other archives, not evidence
that this archive lacks assets.

Usage::

    python3 tools/wzdata.py Data.wz --manifest analysis/data_wz_manifest      # txt + json
    python3 tools/wzdata.py Data.wz --census                                  # value-codec census
    python3 tools/wzdata.py Data.wz --maps analysis/map_meta.json             # Map/Map/*.img metadata
    python3 tools/wzdata.py Data.wz --dump Character/Cap/01000000.img         # one image, as a tree
"""
from __future__ import annotations

import collections
import json
import mmap
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wz1  # noqa: E402
from wzimg import (Canvas, ImageStream, Node, Object, find_objects,  # noqa: E402
                   parse_image, walk_values)


#: classes an image blob may start with (measured: all 1,056 are ``Property``)
IMAGE_ROOT_CLASSES = ("Property", "#")


class Resolved:
    """Where one image blob actually lives."""

    __slots__ = ("entry", "offset", "size", "source")

    def __init__(self, entry: wz1.WzEntry, offset: int, size: int, source: str) -> None:
        self.entry = entry
        self.offset = offset
        self.size = size
        self.source = source          # "declared" | "scanned" | "missing"

    @property
    def path(self) -> str:
        return self.entry.path

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Resolved({self.path!r}, {self.offset:#x}, {self.size}, {self.source})"


class DataWz:
    """A parsed archive plus its verified image layout."""

    def __init__(self, path: str) -> None:
        self.path = path
        self.size = os.path.getsize(path)
        self.archive = wz1.WzV1File(path).parse()
        with open(path, "rb") as fh:
            self.data = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
        self.images = [e for e in self.archive.walk() if e.type == wz1.TYPE_IMAGE]
        self._resolved: list[Resolved] | None = None
        self._by_path: dict[str, Resolved] = {}
        self._scan: list[tuple[int, int, str]] | None = None
        self._blobs: dict[str, bytes] = {}

    # -- layout ------------------------------------------------------------
    @property
    def tree_end(self) -> int:
        return self.archive.tree_end

    def scan(self) -> list[tuple[int, int, str]]:
        """Every plain ``Property`` object in the file as ``(offset, length, cls)``."""
        if self._scan is None:
            self._scan = find_objects(bytes(self.data))
        return self._scan

    def _parses_exactly(self, offset: int, size: int) -> bool:
        """True when ``[offset, offset+size)`` is one complete image.

        Parsing to the exact size is not enough on its own: opaque data can
        consume a blob by accident (``Mob/0210100.img`` declares an offset
        that holds pixel-ish noise which parses as a single unknown-class
        object of exactly the right length).  Every image in this archive is
        a ``Property`` container, so demand that too.
        """
        try:
            objs = parse_image(bytes(self.data[offset : offset + size]))
        except Exception:
            return False
        return (bool(objs) and objs[0].cls in IMAGE_ROOT_CLASSES
                and objs[0].offset == 0 and objs[-1].end == size)

    def resolve(self, verify: bool = True) -> list[Resolved]:
        """Assign every image its real byte range (declared offset, else scan)."""
        if self._resolved is not None:
            return self._resolved
        out: list[Resolved] = []
        pending: list[wz1.WzEntry] = []
        for entry in self.images:
            offset = entry.data_offset if entry.data_offset is not None else self.tree_end
            if not verify or self._parses_exactly(offset, entry.size):
                out.append(Resolved(entry, offset, entry.size, "declared"))
            else:
                pending.append(entry)
        if pending:
            by_size: dict[int, list[int]] = collections.defaultdict(list)
            for off, length, _cls in self.scan():
                by_size[length].append(off)
            taken = {r.offset for r in out}
            for entry in pending:
                candidates = [o for o in by_size.get(entry.size, []) if o not in taken]
                if candidates:
                    offset = candidates[0]
                    taken.add(offset)
                    out.append(Resolved(entry, offset, entry.size, "scanned"))
                else:
                    out.append(Resolved(entry, None, entry.size, "missing"))
        self._resolved = out
        self._by_path = {r.path: r for r in out}
        return out

    def blob(self, path: str) -> bytes:
        """The raw bytes of one image, keyed by its WZ path."""
        if path in self._blobs:
            return self._blobs[path]
        res = self._by_path.get(path)
        if res is None:
            for r in self.resolve():
                if r.path == path:
                    res = r
                    break
        if res is None or res.offset is None:
            raise KeyError(f"image not found or unresolved: {path}")
        blob = bytes(self.data[res.offset : res.offset + res.size])
        self._blobs[path] = blob
        return blob

    def objects(self, path: str) -> list[Object]:
        return parse_image(self.blob(path))

    # -- statistics --------------------------------------------------------
    def canvas_census(self) -> dict:
        """How many canvases exist and whether their pixels come back whole."""
        stats: collections.Counter = collections.Counter()
        canvases = 0
        for entry in self.images:
            try:
                objs = parse_image(self.blob(entry.path))
            except Exception as exc:
                stats[f"image parse failed: {type(exc).__name__}"] += 1
                continue
            for obj in objs:
                for canvas in walk_values(obj):
                    canvases += 1
                    stats[f"fmt {canvas.fmt}"] += 1
                    if canvas.pixel is None:
                        stats["pixels not decoded"] += 1
                    elif canvas.partial:
                        stats["pixels short (zero padded)"] += 1
                    else:
                        stats["pixels exact"] += 1
        stats["canvases"] = canvases
        return dict(stats)

    def unlisted_objects(self) -> list[tuple[int, int]]:
        """File objects that no image of the same size claims (stale leftovers)."""
        sizes = {e.size for e in self.images}
        return [(off, length) for off, length, _cls in self.scan() if length not in sizes]

    def manifest(self) -> dict:
        resolved = self.resolve()
        stats = collections.Counter(r.source for r in resolved)
        unlisted = self.unlisted_objects()
        return {
            "file": os.path.basename(self.path),
            "file_size": self.size,
            "wz_version": self.archive.wz_version,
            "tree_end": self.tree_end,
            "image_count": len(self.images),
            "image_bytes": sum(e.size for e in self.images),
            "resolved": dict(stats),
            "unlisted_objects": len(unlisted),
            "unlisted_bytes": sum(length for _off, length in unlisted),
            "images": [
                {
                    "path": r.path,
                    "size": r.size,
                    "checksum": r.entry.checksum,
                    "offset": r.offset,
                    "source": r.source,
                }
                for r in resolved
            ],
        }

    # -- map metadata ------------------------------------------------------
    def map_metadata(self, ids: list[str] | None = None) -> dict:
        """``info`` / ``foothold`` / ``portal`` / ``life`` for ``Map/Map/*.img``."""
        out: dict[str, dict] = {}
        for entry in self.images:
            if not entry.path.startswith("Map/Map/") or not entry.path.endswith(".img"):
                continue
            map_id = entry.path[len("Map/Map/") : -len(".img")]
            if ids is not None and map_id not in ids:
                continue
            try:
                objs = self.objects(entry.path)
            except Exception as exc:
                out[map_id] = {"error": f"{type(exc).__name__}: {exc}"}
                continue
            root = objs[0] if objs else None
            out[map_id] = map_summary(root)
        return out


def render(value, indent: int) -> list[str]:
    """One decoded value as tree lines (canvases and links get their own form)."""
    pad = "  " * indent
    if isinstance(value, Node) and value.kind == "canvas":
        canvas = value.value
        head = (f"{pad}canvas {canvas.width}x{canvas.height} fmt={canvas.fmt} "
                f"pixels={len(canvas.pixel_raw)}B"
                + (" [short]" if canvas.partial else ""))
        rows = [head]
        for name, t, item in canvas.props:
            rows += render_entry(name, t, item, indent + 1)
        return rows
    if isinstance(value, Node) and value.kind == "uol":
        return [f"{pad}-> {value.value}"]
    if isinstance(value, Node) and value.kind == "vector":
        return [f"{pad}({value.value[0]}, {value.value[1]})"]
    if isinstance(value, Node) and value.kind == "props":
        rows = []
        for name, t, item in value.value:
            rows += render_entry(name, t, item, indent)
        return rows
    if isinstance(value, Node) and value.kind == "convex":
        rows = []
        for item in value.value:
            rows += render(item, indent)
        return rows
    if isinstance(value, Node):
        return [f"{pad}<{value.kind} {len(value.value)}B>"]
    return [f"{pad}{value!r}"]


def render_entry(name: str, t: int, value, indent: int) -> list[str]:
    pad = "  " * indent
    if not isinstance(value, Node):
        return [f"{pad}{name}  t{t}  {value!r}"]
    return [f"{pad}{name}  t{t}"] + render(value, indent + 1)


def dump(obj: Object) -> str:
    """Render one image as an indented tree (names, types, values)."""
    rows = []
    for name, t, value in obj.props:
        rows += render_entry(name, t, value, 0)
    return "\n".join(rows)


def plain(value):
    """Convert a decoded value to something JSON can hold."""
    if isinstance(value, Canvas):
        return {
            "__canvas__": True,
            "width": value.width,
            "height": value.height,
            "format": value.fmt,
            "pixel_bytes": len(value.pixel_raw),
            "decoded_bytes": len(value.pixel) if value.pixel else None,
            "props": [[n, t, plain(v)] for n, t, v in value.props],
        }
    if isinstance(value, Node):
        return plain(value.value)
    if isinstance(value, Object):
        return [[n, t, plain(v)] for n, t, v in value.props]
    if isinstance(value, bytes):
        return {"__bytes__": len(value)}
    if isinstance(value, list):
        return [plain(v) for v in value]
    if isinstance(value, tuple):
        return [plain(v) for v in value]
    return value


def map_summary(root: Object | None) -> dict:
    if root is None:
        return {"error": "empty image"}
    summary: dict = {"info": {}, "foothold": 0, "ladderRope": 0, "portal": [], "life": []}
    for name, _t, value in root.props:
        if name == "info" and isinstance(value, Node):
            summary["info"] = {n: plain(v) for n, _t2, v in value.props}
        elif name == "foothold" and isinstance(value, Node):
            total = 0
            for _page, _pt, page in value.props:
                if isinstance(page, Node):
                    for _group, _gt, group in page.props:
                        if isinstance(group, Node):
                            total += len(group.props)
            summary["foothold"] = total
        elif name == "ladderRope" and isinstance(value, Node):
            summary["ladderRope"] = len(value.props)
        elif name == "portal" and isinstance(value, Node):
            for _idx, _pt, portal in value.props:
                if isinstance(portal, Node):
                    props = {n: plain(v) for n, _t2, v in portal.props}
                    summary["portal"].append(props)
        elif name == "life" and isinstance(value, Node):
            for _idx, _pt, life in value.props:
                if isinstance(life, Node):
                    summary["life"].append({n: plain(v) for n, _t2, v in life.props})
    return summary


# -- CLI -------------------------------------------------------------------
def _write_manifest(wz: DataWz, stem: str) -> None:
    mf = wz.manifest()
    txt = f"{stem}.txt"
    with open(txt, "w", encoding="utf-8") as fh:
        fh.write(f"{mf['file']}: v{mf['wz_version']} size={mf['file_size']:,} "
                 f"treeEnd={mf['tree_end']:#x}\n")
        fh.write(f"images: {mf['image_count']}  bytes: {mf['image_bytes']:,}  "
                 f"resolved: {mf['resolved']}\n")
        fh.write(f"unlisted objects: {mf['unlisted_objects']}  "
                 f"unlisted bytes: {mf['unlisted_bytes']:,}\n")
        for img in mf["images"]:
            fh.write(f"  {img['path']:40s} off={img['offset']:#011x} size={img['size']:>9,} "
                     f"check={img['checksum']:#010x} {img['source']}\n")
    with open(f"{stem}.json", "w", encoding="utf-8") as fh:
        json.dump(mf, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {txt} and {stem}.json")
    print(f"  resolved: {mf['resolved']}   unlisted: {mf['unlisted_objects']} objects / "
          f"{mf['unlisted_bytes']:,} bytes")


def _census(wz: DataWz) -> None:
    mf = wz.manifest()
    print(f"{mf['file']}: images={mf['image_count']} resolved={mf['resolved']} "
          f"unlisted={mf['unlisted_objects']}/{mf['unlisted_bytes']:,}B")
    for key, value in sorted(wz.canvas_census().items()):
        print(f"  {key:34s} {value}")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    wz = DataWz(argv[1])
    args = argv[2:]
    if not args or "--census" in args:
        _census(wz)
    if "--dump" in args:
        idx = args.index("--dump")
        path = args[idx + 1]
        print(dump(wz.objects(path)[0]))
    if "--manifest" in args:
        idx = args.index("--manifest")
        stem = args[idx + 1] if len(args) > idx + 1 else "analysis/data_wz_manifest"
        _write_manifest(wz, stem)
    if "--maps" in args:
        idx = args.index("--maps")
        out = args[idx + 1] if len(args) > idx + 1 else "analysis/map_meta.json"
        ids = [a for a in args if a.isdigit()] or None
        meta = wz.map_metadata(ids)
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=1, ensure_ascii=False)
            fh.write("\n")
        print(f"wrote {out} ({len(meta)} maps)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
