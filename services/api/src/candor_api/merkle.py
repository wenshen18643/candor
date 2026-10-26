from hashlib import sha256


def leaf_hash(value: bytes) -> bytes:
    return sha256(b"\x00" + value).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    return sha256(b"\x01" + left + right).digest()


class MerkleTree:
    def __init__(self, leaves: list[bytes]) -> None:
        self.leaves = leaves
        self.cache: dict[tuple[int, int], bytes] = {}
        self.root()

    def subtree(self, start: int, size: int) -> bytes:
        key = (start, size)
        if key not in self.cache:
            if size == 0:
                value = sha256(b"").digest()
            elif size == 1:
                value = leaf_hash(self.leaves[start])
            else:
                split = 1 << ((size - 1).bit_length() - 1)
                value = node_hash(
                    self.subtree(start, split), self.subtree(start + split, size - split)
                )
            self.cache[key] = value
        return self.cache[key]

    def root(self, size: int | None = None) -> bytes:
        size = len(self.leaves) if size is None else size
        if not 0 <= size <= len(self.leaves):
            raise ValueError("Invalid tree size")
        return self.subtree(0, size)

    def append(self, leaf: bytes) -> None:
        self.leaves.append(leaf)
        self.root()

    def inclusion(self, index: int, size: int) -> list[bytes]:
        if not 0 <= index < size <= len(self.leaves):
            raise ValueError("Invalid inclusion range")
        return self.inclusion_subtree(index, 0, size)

    def inclusion_subtree(self, index: int, start: int, size: int) -> list[bytes]:
        if size == 1:
            return []
        split = 1 << ((size - 1).bit_length() - 1)
        if index < split:
            return [
                *self.inclusion_subtree(index, start, split),
                self.subtree(start + split, size - split),
            ]
        return [
            *self.inclusion_subtree(index - split, start + split, size - split),
            self.subtree(start, split),
        ]

    def consistency(self, first: int, second: int) -> list[bytes]:
        if not 0 <= first <= second <= len(self.leaves):
            raise ValueError("Invalid consistency range")
        if first in {0, second}:
            return []
        return self.consistency_subtree(first, 0, second, True)

    def consistency_subtree(self, first: int, start: int, size: int, complete: bool) -> list[bytes]:
        if first == size:
            return [] if complete else [self.subtree(start, size)]
        split = 1 << ((size - 1).bit_length() - 1)
        if first <= split:
            return [
                *self.consistency_subtree(first, start, split, complete),
                self.subtree(start + split, size - split),
            ]
        return [
            *self.consistency_subtree(first - split, start + split, size - split, False),
            self.subtree(start, split),
        ]


def verify_inclusion(leaf: bytes, index: int, size: int, proof: list[bytes], root: bytes) -> bool:
    if not 0 <= index < size:
        return False
    position, last = index, size - 1
    value = leaf_hash(leaf)
    for sibling in proof:
        if last == 0 or len(sibling) != 32:
            return False
        if position & 1 or position == last:
            value = node_hash(sibling, value)
            while position and not position & 1:
                position >>= 1
                last >>= 1
        else:
            value = node_hash(value, sibling)
        position >>= 1
        last >>= 1
    return last == 0 and value == root


def verify_consistency(first: int, second: int, old: bytes, new: bytes, proof: list[bytes]) -> bool:
    if not 0 <= first <= second:
        return False
    if first == 0:
        return not proof and old == sha256(b"").digest()
    if first == second:
        return not proof and old == new
    position, last = first - 1, second - 1
    while position & 1:
        position >>= 1
        last >>= 1
    path = list(proof)
    if position == 0:
        old_value = new_value = old
    elif path:
        old_value = new_value = path.pop(0)
    else:
        return False
    for sibling in path:
        if last == 0 or len(sibling) != 32:
            return False
        if position & 1 or position == last:
            old_value = node_hash(sibling, old_value)
            new_value = node_hash(sibling, new_value)
            while position and not position & 1:
                position >>= 1
                last >>= 1
        else:
            new_value = node_hash(new_value, sibling)
        position >>= 1
        last >>= 1
    return last == 0 and old_value == old and new_value == new


def sth_message(size: int, root: str, timestamp: str) -> bytes:
    return f"candor/v1/sth\n{size}\n{root}\n{timestamp}".encode()
