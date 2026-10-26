import ast
import io
import sys
import tokenize
from pathlib import Path

SKIP_DIRS = {".venv", "__pycache__", "node_modules", ".pytest_cache", ".ruff_cache", "data"}


def iter_python_files(roots: list[Path]):
    for root in roots:
        if root.is_file() and root.suffix == ".py":
            yield root
            continue
        for path in root.rglob("*.py"):
            if not SKIP_DIRS.intersection(path.parts):
                yield path


def comment_violations(source: str) -> list[int]:
    lines = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type != tokenize.COMMENT:
            continue
        if token.start[0] == 1 and token.string.startswith("#!"):
            continue
        lines.append(token.start[0])
    return lines


def docstring_violations(source: str) -> list[int]:
    tree = ast.parse(source)
    lines = []
    nodes = [tree, *ast.walk(tree)]
    for node in nodes:
        if not isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        body = getattr(node, "body", [])
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            lines.append(body[0].lineno)
    return sorted(set(lines))


def main() -> int:
    roots = [Path(arg) for arg in sys.argv[1:]] or [Path()]
    failures = []
    for path in iter_python_files(roots):
        source = path.read_text(encoding="utf-8")
        failures.extend(f"{path}:{line}: comment" for line in comment_violations(source))
        failures.extend(f"{path}:{line}: docstring" for line in docstring_violations(source))
    for failure in failures:
        print(failure)
    if failures:
        print(f"{len(failures)} comment/docstring violation(s); this codebase forbids them.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
