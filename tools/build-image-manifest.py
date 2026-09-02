#!/usr/bin/env python3
"""
Write site/assets/img/manifest.json: the list of images the admin panel offers.

Images come in families (hero-threshold-900.webp + hero-threshold-1600.webp are
one picture at two widths). The admin swaps a whole family at once, so it needs
to know which files belong together and the intrinsic size of the largest, to
keep width/height on the tag honest.

Run after adding or removing images:  python tools/build-image-manifest.py
"""
import json, pathlib, re, sys
from PIL import Image

IMG = pathlib.Path(__file__).resolve().parent.parent / "site" / "assets" / "img"
LABELS = {
    "hero-threshold": "Figura en el umbral, amanecer",
    "house-travel": "Avión desde abajo",
    "house-al": "Frasco sobre muro de cal",
    "house-foods": "Materia prima sobre piedra",
    "house-trade": "Muelle a contraluz",
    "house-properties": "Esquina de hormigón",
    "house-mobility": "Vehículo contra el sol bajo",
    "threshold-arch": "Vano de piedra",
    "threshold-fog": "Niebla entre dos planos",
    "threshold-slab": "Losa vertical sobre la llanura",
    "air-plain": "Dos tercios de cielo",
    "matter-cornice": "Cornisa contra el cielo",
    "matter-apex": "Ápice de hormigón",
    "backlight-wall": "Sol detrás del muro",
    "og": "Imagen para compartir",
    "tex-concrete-blue": "Textura, hormigón azul",
}

def main():
    fams = {}
    for f in sorted(IMG.glob("*.webp")) + sorted(IMG.glob("*.jpg")):
        m = re.match(r"(.+?)-(\d+)\.(webp|jpg)$", f.name)
        family, width = (m.group(1), int(m.group(2))) if m else (f.stem, None)
        e = fams.setdefault(family, {"family": family, "ext": f.suffix.lstrip("."),
                                     "widths": [], "w": 0, "h": 0})
        if width:
            e["widths"].append(width)
        try:
            with Image.open(f) as im:
                if im.width > e["w"]:
                    e["w"], e["h"] = im.width, im.height
        except Exception as err:
            print(f"  ! {f.name}: {err}", file=sys.stderr)

    out = []
    for fam in sorted(fams.values(), key=lambda x: x["family"]):
        fam["widths"].sort()
        fam["label"] = LABELS.get(fam["family"], fam["family"].replace("-", " "))
        fam["thumb"] = (f"/assets/img/{fam['family']}-{fam['widths'][0]}.{fam['ext']}"
                        if fam["widths"] else f"/assets/img/{fam['family']}.{fam['ext']}")
        out.append(fam)

    dest = IMG / "manifest.json"
    dest.write_text(json.dumps({"images": out}, indent=1, ensure_ascii=False), encoding="utf8")
    print(f"  {len(out)} image families -> {dest.relative_to(dest.parents[3])}")
    for f in out:
        print(f"    {f['family']:<22} {f['w']}x{f['h']:<6} widths={f['widths'] or ['-']}")

if __name__ == "__main__":
    main()
