"""Build and verify the installable plugin ZIP using only the Python standard library."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ["manifest.json", "icon.png", "background.js", "core.js", "store.js",
         "ui/index.html", "ui/style.css", "ui/main.js", "README.md",
         "intro/zh/README.md", "docs/development.md", "docs/verification.md", "LICENSE"]


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    expected = {"focus.changed", "focus.app", "focus.title", "notifications"}
    assert set(manifest["permissions"]) == expected, "Unexpected permissions"
    assert manifest["runs_in_background"] is True
    assert manifest["storage_mb"] == 1
    icon = (ROOT / "icon.png").read_bytes()
    assert icon.startswith(b"\x89PNG\r\n\x1a\n"), "Icon must be a PNG"
    assert len(icon) <= 256 * 1024, "Icon exceeds host limit"
    for name in FILES:
        assert (ROOT / name).is_file(), f"Missing package file: {name}"
    html = (ROOT / "ui/index.html").read_text(encoding="utf-8")
    assert '../_page.js' in html, "Missing Hindsight page bridge"
    destination = ROOT / "dist" / f'{manifest["id"]}-{manifest["version"]}.zip'
    destination.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            data = (ROOT / name).read_bytes()
            if name != "icon.png":
                data = data.decode("utf-8-sig").replace("\r\n", "\n").encode("utf-8")
            entry = zipfile.ZipInfo(name, date_time=(2026, 10, 24, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data)
    with zipfile.ZipFile(destination) as archive:
        assert set(archive.namelist()) == set(FILES)
        assert archive.testzip() is None
        assert json.loads(archive.read("manifest.json")) == manifest
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    checksum = destination.with_suffix(".zip.sha256")
    checksum.write_text(f"{digest}  {destination.name}\n", encoding="utf-8")
    entry = {
        "id": manifest["id"], "name": manifest["name"], "author": "Yoshino2000",
        "description": {
            "zh-CN": "进入指定网站或程序时发送自定义通知，支持多规则、启停和冷却时间",
            "en": "Custom notifications when entering a website or app, with multiple rules, pause switches and cooldowns",
        },
        "repo": "Yoshino2000/hindsight-reminder",
        "versions": [{
            "version": manifest["version"],
            "url": f'https://github.com/Yoshino2000/hindsight-reminder/releases/download/{manifest["version"]}/{destination.name}',
            "sha256": digest, "permissions": manifest["permissions"],
            "storage_mb": manifest["storage_mb"],
        }],
    }
    (destination.parent / "market-entry.json").write_text(
        json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"zip": str(destination), "bytes": destination.stat().st_size,
                      "sha256": digest, "files": FILES}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
