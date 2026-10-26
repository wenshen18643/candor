import base64
import hashlib
import json
import math
from pathlib import Path

import nacl.bindings as sodium
from nacl.encoding import RawEncoder
from nacl.hash import blake2b
from nacl.pwhash import argon2id

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "specs" / "vectors" / "protocol-vectors.json"


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def padme(length: int) -> int:
    exponent = math.floor(math.log2(length))
    significant = math.floor(math.log2(exponent)) + 1
    zero_bits = exponent - significant
    step = 2**zero_bits
    return math.ceil(length / step) * step


def leaf_hash(data: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + data).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def split_point(n: int) -> int:
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def mth(leaves: list[bytes]) -> bytes:
    if not leaves:
        return hashlib.sha256(b"").digest()
    if len(leaves) == 1:
        return leaf_hash(leaves[0])
    k = split_point(len(leaves))
    return node_hash(mth(leaves[:k]), mth(leaves[k:]))


def inclusion_path(index: int, leaves: list[bytes]) -> list[bytes]:
    if len(leaves) <= 1:
        return []
    k = split_point(len(leaves))
    if index < k:
        return [*inclusion_path(index, leaves[:k]), mth(leaves[k:])]
    return [*inclusion_path(index - k, leaves[k:]), mth(leaves[:k])]


def subproof(m: int, leaves: list[bytes], complete: bool) -> list[bytes]:
    n = len(leaves)
    if m == n:
        return [] if complete else [mth(leaves)]
    k = split_point(n)
    if m <= k:
        return [*subproof(m, leaves[:k], complete), mth(leaves[k:])]
    return [*subproof(m - k, leaves[k:], False), mth(leaves[:k])]


def consistency_proof(m: int, leaves: list[bytes]) -> list[bytes]:
    return subproof(m, leaves, True)


def generichash(size: int, message: bytes, key: bytes = b"") -> bytes:
    return blake2b(message, digest_size=size, key=key, encoder=RawEncoder)


def main() -> None:
    padme_cases = [
        {"length": n, "padded": padme(n)} for n in [4, 5, 9, 100, 1000, 1025, 5000, 65537, 1048577]
    ]

    log_leaves = [
        json.dumps({"i": i, "type": "test"}, sort_keys=True, separators=(",", ":")).encode()
        for i in range(7)
    ]
    file_digests = [hashlib.sha256(f"file-{i}".encode()).digest() for i in range(3)]

    merkle = {
        "leaves_b64u": [b64u(leaf) for leaf in log_leaves],
        "roots": {str(n): mth(log_leaves[:n]).hex() for n in range(8)},
        "inclusion": [
            {
                "index": i,
                "tree_size": n,
                "path": [h.hex() for h in inclusion_path(i, log_leaves[:n])],
            }
            for n in (1, 2, 3, 5, 7)
            for i in range(n)
        ],
        "consistency": [
            {
                "first": m,
                "second": n,
                "proof": [h.hex() for h in consistency_proof(m, log_leaves[:n])],
            }
            for n in (2, 3, 5, 7)
            for m in range(1, n)
        ],
        "evidence_root": {
            "file_sha256": [d.hex() for d in file_digests],
            "root": mth(file_digests).hex(),
        },
    }

    inbox_salt = generichash(16, b"candor/v1/inbox-salt")
    codename = "orbit-velvet-harbor-quilt-ember-sparrow-lantern-meadow"
    seed = argon2id.kdf(32, codename.encode(), inbox_salt, opslimit=3, memlimit=67108864)
    sign_seed = generichash(32, b"sign", key=seed)
    box_seed = generichash(32, b"box", key=seed)
    sign_pk, _ = sodium.crypto_sign_seed_keypair(sign_seed)
    box_pk, _ = sodium.crypto_box_seed_keypair(box_seed)

    aead_key = bytes(range(32))
    aead_nonce = bytes(range(24))
    report_id = "00000000-0000-4000-8000-000000000000"
    ad = f"candor/v1/manifest/{report_id}".encode()
    plaintext = b'{"hello":"candor"}'
    framed = len(plaintext).to_bytes(4, "big") + plaintext
    framed += b"\x00" * (padme(len(framed)) - len(framed))
    ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(framed, ad, aead_nonce, aead_key)

    vectors = {
        "padme": padme_cases,
        "merkle": merkle,
        "inbox": {
            "salt_b64u": b64u(inbox_salt),
            "codename": codename,
            "normalized_inputs": [
                "Orbit Velvet  Harbor_quilt-ember--sparrow lantern MEADOW",
                " orbit-velvet-harbor-quilt-ember-sparrow-lantern-meadow ",
            ],
            "opslimit": 3,
            "memlimit": 67108864,
            "seed_b64u": b64u(seed),
            "sign_pk_b64u": b64u(sign_pk),
            "box_pk_b64u": b64u(box_pk),
        },
        "candor_box": {
            "key_b64u": b64u(aead_key),
            "nonce_b64u": b64u(aead_nonce),
            "ad": ad.decode(),
            "plaintext": plaintext.decode(),
            "box": {"v": 1, "alg": "xc20p-padme", "n": b64u(aead_nonce), "c": b64u(ciphertext)},
        },
        "key_id": {
            "public_key_b64u": b64u(box_pk),
            "key_id": generichash(16, box_pk).hex(),
        },
        "sth_message": {
            "tree_size": 7,
            "root_hash": mth(log_leaves).hex(),
            "timestamp": "2026-10-26T10:00:00Z",
            "message": f"candor/v1/sth\n7\n{mth(log_leaves).hex()}\n2026-10-26T10:00:00Z",
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(vectors, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
