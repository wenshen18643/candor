import base64
import hashlib
import math
import secrets
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from candor_api.common import b64u, canonical
from candor_api.integrations import Issuer


def issuer_for(key: rsa.RSAPrivateKey) -> Issuer:
    der = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return Issuer(key_id=hashlib.sha256(der).hexdigest()[:16], spki=b64u(der))


def mgf1(seed: bytes, length: int) -> bytes:
    return b"".join(
        hashlib.sha384(seed + index.to_bytes(4, "big")).digest()
        for index in range(math.ceil(length / 48))
    )[:length]


def blind_token(key: rsa.RSAPrivateKey) -> dict[str, str]:
    prepared = secrets.token_bytes(32) + secrets.token_bytes(32)
    salt = secrets.token_bytes(48)
    digest = hashlib.sha384(b"\x00" * 8 + hashlib.sha384(prepared).digest() + salt).digest()
    database = b"\x00" * 158 + b"\x01" + salt
    masked = bytearray(
        left ^ right for left, right in zip(database, mgf1(digest, 207), strict=True)
    )
    masked[0] &= 127
    encoded = bytes(masked) + digest + b"\xbc"
    numbers = key.private_numbers()
    modulus, exponent = numbers.public_numbers.n, numbers.public_numbers.e
    randomizer = secrets.randbelow(modulus - 2) + 2
    while math.gcd(randomizer, modulus) != 1:
        randomizer = secrets.randbelow(modulus - 2) + 2
    blinded = int.from_bytes(encoded, "big") * pow(randomizer, exponent, modulus) % modulus
    blind_signature = pow(blinded, numbers.d, modulus)
    assert pow(blind_signature, exponent, modulus) == blinded
    signature = (blind_signature * pow(randomizer, -1, modulus) % modulus).to_bytes(256, "big")
    key.public_key().verify(
        signature,
        prepared,
        padding.PSS(mgf=padding.MGF1(hashes.SHA384()), salt_length=48),
        hashes.SHA384(),
    )
    return {
        "key_id": issuer_for(key).key_id,
        "prepared": b64u(prepared),
        "signature": b64u(signature),
    }


def box() -> dict[str, Any]:
    return {
        "v": 1,
        "alg": "xc20p-padme",
        "n": b64u(secrets.token_bytes(24)),
        "c": b64u(secrets.token_bytes(64)),
    }


def seal() -> dict[str, Any]:
    return {"v": 1, "alg": "seal-padme", "c": b64u(secrets.token_bytes(96))}


def mock_payment(nonce: str | None = None) -> str:
    payload = {
        "x402Version": 1,
        "scheme": "exact",
        "network": "base-sepolia",
        "payload": {
            "mock": True,
            "payer": "0x" + "12" * 20,
            "nonce": nonce or "0x" + secrets.token_hex(32),
        },
    }
    return base64.b64encode(canonical(payload)).decode()
