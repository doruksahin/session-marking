#!/usr/bin/env python3
"""Architecture contract v1. Vendored unchanged from plugin-architecture.

Python 3.11+, standard library only. Never execute repository commands or read credentials.
"""
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

HEADINGS = (
    "Responsibility", "Interfaces", "Dependencies", "Execution and storage",
    "Failure behavior", "Current implementation", "Planned changes", "Decisions", "Verification",
)
FIELDS = {
    "schemaVersion", "id", "kind", "repository", "owner", "document",
    "sourcePaths", "dependencyChecks", "boundaryChecks",
}
INTERNAL_PREFIXES = ("@doruksahin/", "@adcreative/")
DEPENDENCY_SECTIONS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)


def plain_markdown(text):
    """Ignore fenced examples when checking headings and authored links."""
    lines, fence = [], None
    for line in text.splitlines():
        match = re.match(r"^\s*(`{3,}|~{3,})", line)
        if match:
            token = match.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            lines.append("")
        else:
            lines.append(line if fence is None else "")
    return "\n".join(lines)


def check_repository(root):
    root = Path(root).resolve()
    errors = []

    def fail(message):
        errors.append(message)

    def local_file(value, label, relative_to=None):
        if not isinstance(value, str) or not value or Path(value).is_absolute():
            fail(f"{label}: expected a nonempty repository-relative path")
            return None
        candidate = ((relative_to or root) / value).resolve()
        if not candidate.is_relative_to(root):
            fail(f"{label}: path escapes repository")
            return None
        if not candidate.is_file():
            fail(f"{label}: missing file {value}")
            return None
        return candidate

    try:
        config = read_json(root / ".architecture/contract.json")
    except (OSError, ValueError) as exc:
        return None, [f"contract: {exc}"]
    if not isinstance(config, dict):
        return None, ["contract: expected a JSON object"]
    if set(config) != FIELDS:
        fail(f"contract fields: missing={sorted(FIELDS - set(config))}, unknown={sorted(set(config) - FIELDS)}")
    if type(config.get("schemaVersion")) is not int or config["schemaVersion"] != 1:
        fail("schemaVersion: expected 1")
    identity = config.get("id")
    if not isinstance(identity, str) or not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", identity):
        fail("id: expected stable kebab-case identifier")
    if config.get("kind") not in ("plugin", "package", "tooling"):
        fail("kind: expected plugin, package, or tooling")
    repository = config.get("repository")
    if not isinstance(repository, str) or not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        fail("repository: expected canonical https://github.com/owner/repository URL")
    if not isinstance(config.get("owner"), str) or not config["owner"].strip():
        fail("owner: expected a nonempty accountable owner")
    if config.get("document") != "docs/architecture/README.md":
        fail("document: expected docs/architecture/README.md")

    document = local_file(config.get("document"), "document")
    if document:
        raw = document.read_text(encoding="utf-8")
        prose = plain_markdown(raw)
        sections = list(re.finditer(r"^## (.+)$", prose, re.MULTILINE))
        headings = [match.group(1).strip() for match in sections]
        if headings != list(HEADINGS):
            fail(f"document: expected ordered sections {', '.join(HEADINGS)}; got {', '.join(headings)}")
        for index, section in enumerate(sections):
            end = sections[index + 1].start() if index + 1 < len(sections) else len(prose)
            if not prose[section.end():end].strip():
                fail(f"document: empty section {section.group(1)}")
        if re.search(r"\b(?:TODO|TBD|FIXME)\b|\{\{[^}]+\}\}", prose):
            fail("document: unresolved template content")
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", prose):
            target = target.strip().strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme in ("https", "http", "mailto") or not parsed.path:
                continue
            if parsed.scheme or target.startswith("//"):
                fail(f"document link: unsupported target {target}")
                continue
            local_file(unquote(parsed.path), "document link", document.parent)

    for name in ("README.md", "AGENTS.md"):
        pointer = local_file(name, name)
        if pointer and "docs/architecture/README.md" not in pointer.read_text(encoding="utf-8"):
            fail(f"{name}: missing architecture entry pointer")
    workflow = local_file(".github/workflows/architecture.yml", "CI workflow")
    if workflow and "python3 .architecture/check.py" not in workflow.read_text(encoding="utf-8"):
        fail("CI workflow: missing shared checker invocation")

    sources = config.get("sourcePaths")
    if not isinstance(sources, list) or not sources:
        fail("sourcePaths: expected nonempty array of source evidence files")
    else:
        for source in sources:
            local_file(source, "sourcePaths")
        if all(isinstance(source, str) for source in sources) and len(set(sources)) != len(sources):
            fail("sourcePaths: duplicate file")

    checks = config.get("dependencyChecks")
    seen_manifests = set()
    if not isinstance(checks, list):
        fail("dependencyChecks: expected array")
    else:
        for check in checks:
            if not isinstance(check, dict) or set(check) != {"manifest", "allowedInternalPackages"}:
                fail("dependencyChecks: each rule needs manifest and allowedInternalPackages")
                continue
            manifest = local_file(check["manifest"], "dependency manifest")
            if manifest in seen_manifests:
                fail("dependencyChecks: duplicate manifest")
            seen_manifests.add(manifest)
            allowed = check["allowedInternalPackages"]
            if not isinstance(allowed, list) or any(not isinstance(item, str) or not item.startswith(INTERNAL_PREFIXES) for item in allowed):
                fail("allowedInternalPackages: expected internal package names")
                continue
            if len(set(allowed)) != len(allowed):
                fail("allowedInternalPackages: duplicate package")
            if manifest is None:
                continue
            try:
                package = read_json(manifest)
                actual = set()
                if not isinstance(package, dict):
                    raise ValueError("manifest must be an object")
                for section in DEPENDENCY_SECTIONS:
                    dependencies = package.get(section, {})
                    if not isinstance(dependencies, dict):
                        raise ValueError(f"{section} must be an object")
                    actual.update(name for name in dependencies if name.startswith(INTERNAL_PREFIXES))
                if actual != set(allowed):
                    fail(f"{check['manifest']}: internal dependency drift; undeclared={sorted(actual - set(allowed))}, stale={sorted(set(allowed) - actual)}")
            except (OSError, ValueError) as exc:
                fail(f"dependency manifest: {exc}")

    checks = config.get("boundaryChecks")
    if not isinstance(checks, list):
        fail("boundaryChecks: expected array")
    else:
        for check in checks:
            if not isinstance(check, dict) or set(check) != {"paths", "forbidden"}:
                fail("boundaryChecks: each rule needs paths and forbidden")
                continue
            paths, forbidden = check["paths"], check["forbidden"]
            if not isinstance(paths, list) or not paths or not isinstance(forbidden, list) or not forbidden or any(not isinstance(item, str) or not item.strip() for item in forbidden):
                fail("boundaryChecks: paths and forbidden must be nonempty arrays of strings")
                continue
            for value in paths:
                path = local_file(value, "boundary source")
                if path:
                    source = path.read_text(encoding="utf-8")
                    for token in forbidden:
                        if token in source:
                            fail(f"{value}: forbidden source reference {token}")
    return identity, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        identity, errors = check_repository(args.root)
    except (OSError, UnicodeError, ValueError) as exc:
        identity, errors = None, [f"unreadable contract evidence: {exc}"]
    if errors:
        for error in errors:
            print(f"ARCHITECTURE_ERROR: {error}", file=sys.stderr)
        return 1
    print(f"ARCHITECTURE_OK: {identity}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
