# -*- coding: utf-8 -*-
"""
X-Reader 发布构建脚本：版本号 patch +1 → 构建 NSIS 安装包 → 生成 update.json

用法：
    python scripts/build-update.py                    # 完整发布流程（增量构建）
    python scripts/build-update.py --notes "更新说明"  # 指定更新说明（不再交互询问）
    python scripts/build-update.py --no-build         # 只升版本号 + 生成清单（需已有对应安装包）
    python scripts/build-update.py --no-bump          # 沿用当前版本号构建（不自动 +1）
    python scripts/build-update.py --manifest-only    # 不升版本，用当前版本已有安装包重新生成清单
    python scripts/build-update.py --dry-run          # 只显示下一个版本号，不写文件
    python scripts/build-update.py --full             # 清理应用 crate 后重编（排障用，依赖仍缓存）

产物：
    src-tauri/target/release/bundle/nsis/X-Reader_<新版本>_x64-setup.exe
    scripts/.docs/update.json

发布：把安装包和 scripts/.docs/update.json 上传到
    https://qf99.tos-cn-beijing.volces.com/x-reader/
清单地址与 src-tauri/src/update.rs 的 UPDATE_MANIFEST_URL 必须一致。
"""

import hashlib
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

APP_NAME = "X-Reader"
CRATE_NAME = "x-reader"
ROOT = Path(__file__).resolve().parent.parent
SRC_TAURI = ROOT / "src-tauri"
UPDATE_BASE = "https://qf99.tos-cn-beijing.volces.com/x-reader"
MANIFEST_URL = f"{UPDATE_BASE}/update.json"


def log(message: str) -> None:
    print(f"[build] {message}")


def cmd_exe(name: str) -> str:
    """Windows 下 pnpm 是 .cmd 包装器，subprocess 列表模式必须带扩展名。"""
    return f"{name}.cmd" if sys.platform == "win32" else name


def ensure_utf8_stdout() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass


def run(cmd: list[str], cwd: Path, desc: str) -> None:
    log(desc)
    proc = subprocess.run(cmd, cwd=str(cwd))
    if proc.returncode != 0:
        raise RuntimeError(f"{desc}失败（退出码 {proc.returncode}）")


# ===========================================================================
# 版本号
# ===========================================================================

def current_version() -> str:
    with open(SRC_TAURI / "tauri.conf.json", "r", encoding="utf-8") as handle:
        return json.load(handle)["version"]


def bump_version(dry_run: bool = False) -> str:
    """版本号 patch +1（每次发布升一个小版本），校验后统一回写三个文件。"""
    version = current_version()
    major, minor, patch = version.split(".")
    new_version = f"{major}.{minor}.{int(patch) + 1}"
    log(f"版本号 {version} -> {new_version}" + ("（dry-run，未写入）" if dry_run else ""))
    if dry_run:
        return new_version

    json_pattern = r'("version"\s*:\s*")[^"]+(")'
    edits: list[tuple[Path, str]] = []
    for path in (SRC_TAURI / "tauri.conf.json", ROOT / "package.json"):
        text = path.read_text(encoding="utf-8")
        updated, count = re.subn(json_pattern, rf"\g<1>{new_version}\g<2>", text)
        if count != 1:
            raise RuntimeError(f"{path} 中匹配到 {count} 处 version，已中止以避免版本号不同步")
        edits.append((path, updated))

    # Cargo.toml：行首锚定，避开依赖项里的 version
    cargo = SRC_TAURI / "Cargo.toml"
    text = cargo.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'(?m)^(version\s*=\s*")[^"]+(")', rf"\g<1>{new_version}\g<2>", text
    )
    if count != 1:
        raise RuntimeError(f"{cargo} 中匹配到 {count} 处 version，已中止以避免版本号不同步")
    edits.append((cargo, updated))

    for path, updated in edits:
        path.write_text(updated, encoding="utf-8")
    return new_version


def cleanup_caches() -> None:
    """--full 时清理应用 crate 缓存强制重编；默认依赖 Cargo 的增量构建。

    Cargo 会因 Cargo.toml 的版本号变化重编应用 crate；tauri-build 也会通过
    rerun-if-changed 跟踪 tauri.conf.json，所以普通升版本不需要 cargo clean。
    """
    run(
        ["cargo", "clean", "-p", CRATE_NAME],
        SRC_TAURI,
        f"清理 {CRATE_NAME} 缓存（--full）…",
    )


def ensure_frontend_deps() -> None:
    if not (ROOT / "node_modules").exists():
        run([cmd_exe("pnpm"), "install"], ROOT, "安装前端依赖…")


# ===========================================================================
# 更新说明与清单
# ===========================================================================

def read_notes(new_version: str) -> str:
    for index, arg in enumerate(sys.argv):
        if arg == "--notes" and index + 1 < len(sys.argv):
            return sys.argv[index + 1]
    try:
        notes = input("请输入本次更新说明（直接回车使用默认文案）: ").strip()
    except EOFError:
        notes = ""
    return notes or f"{APP_NAME} {new_version} 发布"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_update_json(version: str, notes: str) -> None:
    nsis_dir = SRC_TAURI / "target" / "release" / "bundle" / "nsis"
    expected = f"{APP_NAME}_{version}_x64-setup.exe"
    setup = nsis_dir / expected
    if not setup.exists():
        existing = (
            ", ".join(sorted(p.name for p in nsis_dir.glob("*.exe"))) if nsis_dir.exists() else "目录不存在"
        )
        raise RuntimeError(
            f"找不到安装包 {expected}\n  期望位置: {setup}\n  现有文件: {existing}\n"
            "请先执行完整构建，或确认版本号已正确同步。"
        )

    manifest = {
        "version": version,
        "date": date.today().isoformat(),
        "notes": notes,
        "url": f"{UPDATE_BASE}/{expected}",
        "sha256": sha256_of(setup),
    }
    output = Path(__file__).resolve().parent / ".docs" / "update.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    # Python 默认写 UTF-8 无 BOM，serde_json 可直接解析
    output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    log(f"安装包: {setup}")
    log(f"清单已生成: {output}")
    log(f"清单地址: {MANIFEST_URL}")


def main() -> None:
    ensure_utf8_stdout()
    args = sys.argv[1:]

    if "--manifest-only" in args:
        version = current_version()
        make_update_json(version, read_notes(version))
        log("完成（--manifest-only，未升版本、未构建）")
        return

    if "--dry-run" in args:
        bump_version(dry_run=True)
        return

    print()
    log(f"=== {APP_NAME} 发布构建 ===")
    print()

    if "--no-bump" in args:
        new_version = current_version()
        log(f"沿用当前版本 {new_version}（--no-bump，未升版本）")
    else:
        new_version = bump_version()
    notes = read_notes(new_version)

    if "--no-build" not in args:
        if "--full" in args:
            cleanup_caches()
        else:
            log(
                "增量构建：依赖保持缓存；只重编应用 crate 并重新链接，"
                "tauri-build 会自动跟踪 tauri.conf.json。"
            )
        ensure_frontend_deps()
        run(
            [cmd_exe("pnpm"), "exec", "tauri", "build", "--bundles", "nsis"],
            ROOT,
            f"开始构建安装包（{new_version}，需要几分钟）…",
        )
    else:
        log("--no-build：跳过安装包构建（需要已有对应版本的安装包）")

    make_update_json(new_version, notes)

    print()
    log("=== 完成 ===")
    log(f"安装包: {SRC_TAURI / 'target' / 'release' / 'bundle' / 'nsis' / f'{APP_NAME}_{new_version}_x64-setup.exe'}")
    log(f"清单:   {Path(__file__).resolve().parent / '.docs' / 'update.json'}")
    print()
    log("发布：将安装包和 update.json 上传到")
    log(f"  {UPDATE_BASE}/")
    print()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"\n[build] [错误] {error}", file=sys.stderr)
        sys.exit(1)
