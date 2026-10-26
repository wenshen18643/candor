import json
from pathlib import Path

import pytest
from nacl.signing import VerifyKey

from candor_api.blobs import LocalBlobStore
from candor_api.common import key_id, unb64
from candor_api.merkle import MerkleTree, sth_message, verify_consistency, verify_inclusion
from tests.conftest import Harness

VECTORS = json.loads(
    (Path(__file__).resolve().parents[3] / "docs/specs/vectors/protocol-vectors.json").read_text()
)


def test_merkle_all_shared_vectors() -> None:
    vectors = VECTORS["merkle"]
    leaves = [unb64(value) for value in vectors["leaves_b64u"]]
    tree = MerkleTree(leaves)
    for size, expected in vectors["roots"].items():
        assert tree.root(int(size)).hex() == expected
    for vector in vectors["inclusion"]:
        index, size = vector["index"], vector["tree_size"]
        proof = tree.inclusion(index, size)
        assert [value.hex() for value in proof] == vector["path"]
        assert verify_inclusion(leaves[index], index, size, proof, tree.root(size))
        assert not verify_inclusion(b"tampered", index, size, proof, tree.root(size))
    for vector in vectors["consistency"]:
        first, second = vector["first"], vector["second"]
        proof = tree.consistency(first, second)
        assert [value.hex() for value in proof] == vector["proof"]
        assert verify_consistency(first, second, tree.root(first), tree.root(second), proof)
        assert not verify_consistency(first, second, tree.root(first), b"x" * 32, proof)
    evidence = vectors["evidence_root"]
    assert (
        MerkleTree([bytes.fromhex(value) for value in evidence["file_sha256"]]).root().hex()
        == evidence["root"]
    )


def test_merkle_all_sizes_and_append() -> None:
    tree = MerkleTree([])
    for size in range(1, 65):
        tree.append(str(size).encode())
        assert tree.root() == MerkleTree(tree.leaves.copy()).root()
        for index in range(size):
            assert verify_inclusion(
                tree.leaves[index], index, size, tree.inclusion(index, size), tree.root()
            )
        for first in range(size + 1):
            assert verify_consistency(
                first, size, tree.root(first), tree.root(), tree.consistency(first, size)
            )
    with pytest.raises(ValueError, match="Invalid"):
        tree.inclusion(64, 64)
    with pytest.raises(ValueError, match="Invalid"):
        tree.consistency(2, 1)
    assert not verify_inclusion(b"x", -1, 1, [], b"x" * 32)
    assert not verify_consistency(2, 1, b"x" * 32, b"x" * 32, [])


def test_key_and_sth_vectors() -> None:
    vector = VECTORS["key_id"]
    assert key_id(unb64(vector["public_key_b64u"])) == vector["key_id"]
    sth = VECTORS["sth_message"]
    assert (
        sth_message(sth["tree_size"], sth["root_hash"], sth["timestamp"]).decode() == sth["message"]
    )


def test_signed_log_proofs_and_anchor(harness: Harness) -> None:
    harness.submit()
    client = harness.client
    head = client.get("/v1/log/sth").json()
    public = client.get("/v1/log/key").json()
    VerifyKey(unb64(public["public_key"])).verify(
        sth_message(head["tree_size"], head["root_hash"], head["timestamp"]),
        unb64(head["signature"]),
    )
    entries = client.get("/v1/log/entries?start=0&end=1").json()
    proof = client.get("/v1/log/proofs/inclusion?index=0&tree_size=1").json()
    assert verify_inclusion(
        unb64(entries[0]["leaf_b64u"]),
        0,
        1,
        [bytes.fromhex(value) for value in proof["audit_path"]],
        bytes.fromhex(head["root_hash"]),
    )
    response = client.post("/v1/admin/anchor", headers=harness.login())
    assert response.status_code == 200
    assert response.json()["chain"] == "mock"
    assert len(client.get("/v1/log/anchors").json()) == 1
    proof = client.get("/v1/log/proofs/consistency?first=1&second=2").json()
    new = client.get("/v1/log/sth").json()
    assert verify_consistency(
        1,
        2,
        bytes.fromhex(head["root_hash"]),
        bytes.fromhex(new["root_hash"]),
        [bytes.fromhex(value) for value in proof["proof"]],
    )
    assert client.get("/v1/log/proofs/inclusion?index=3&tree_size=1").status_code == 400
    assert client.get("/v1/log/entries?start=-1&end=1").status_code == 400


def test_blob_integrity_and_traversal(tmp_path: Path) -> None:
    store = LocalBlobStore(tmp_path)
    reference = store.put(b"synthetic-ciphertext")
    assert store.get(reference) == b"synthetic-ciphertext"
    assert store.put(b"synthetic-ciphertext") == reference
    with pytest.raises(ValueError, match="Invalid"):
        store.get("../../secret")
    store.path(reference).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="integrity"):
        store.get(reference)
