"""Build from a verified official Electron distribution. Run the terrain build first."""
import argparse
import hashlib
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("runtime", type=Path, help="Electron v45.5.0 win32-x64 zip")
parser.add_argument("output", type=Path)
args = parser.parse_args()
digest = hashlib.sha256(args.runtime.read_bytes()).hexdigest()
if digest != "20155c8b8aa5b1f575f3757bdf21490e0bac2f19a65a26ce9ba99bcf9f2c69bd":
    sys.exit("Electron checksum mismatch")
with ZipFile(args.runtime) as runtime, ZipFile(args.output,"x",ZIP_DEFLATED,compresslevel=5) as out:
    for member in runtime.infolist():
        if member.filename=="resources/default_app.asar":
            continue
        dest="AMA.exe" if member.filename=="electron.exe" else member.filename
        out.writestr("AMA/"+dest,runtime.read(member))
    app="AMA/resources/app/"
    for name in ["main.cjs","package.json"]:
        out.write(Path(__file__).parent/name,app+name)
    for base in ["index.html","css","js","data","tactical-map","docs"]:
        entry=root/base
        for item in sorted(entry.rglob("*")) if entry.is_dir() else [entry]:
            if item.is_file():out.write(item,app+"web/"+item.relative_to(root).as_posix())
    out.write(Path(__file__).parent/"README.txt","AMA/使用说明.txt")
    out.write(root/"prototype/terrain/node_modules/three/LICENSE","AMA/THREE-LICENSE.txt")
