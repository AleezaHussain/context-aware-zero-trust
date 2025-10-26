"""
Tiny IPE toy service using HMAC as placeholder for IPE ciphertexts.
Run with: uvicorn scripts.ipe_service:app --host 127.0.0.1 --port 8787

This is intentionally minimal — replace the MAC-based logic with a real IPE when ready.
"""
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
import hmac, hashlib, os

app = FastAPI()
# Persistent key file (generate once), fallback to random in-memory key
KEY_PATH = "crypto/ipe_key.bin"
if os.path.exists(KEY_PATH):
    K_ATTR = open(KEY_PATH, "rb").read()
else:
    K_ATTR = os.urandom(32)
    try:
        os.makedirs(os.path.dirname(KEY_PATH), exist_ok=True)
        open(KEY_PATH, "wb").write(K_ATTR)
    except Exception:
        # best-effort persist
        pass

class EncryptReq(BaseModel):
    x: List[int]

class EncryptResp(BaseModel):
    ctAttr: str

class TestReq(BaseModel):
    ctAttr: str
    policyKeyId: str

class TestResp(BaseModel):
    ok: bool

def mac(data: bytes) -> bytes:
    return hmac.new(K_ATTR, data, hashlib.sha256).digest()

@app.post("/ipe/encrypt", response_model=EncryptResp)
def encrypt(req: EncryptReq):
    b = bytes(req.x)
    ct = mac(b)
    return {"ctAttr": "0x" + ct.hex()}

@app.post("/ipe/test", response_model=TestResp)
def test(req: TestReq):
    # Toy policy test: expects the gateway to only call /test when it already
    # knows the policy holds. We accept a policyKeyId string and return true
    # when it matches the canonical policy id for Zone3 env_sensor active.
    ok = (req.policyKeyId == "zone3_active_envsensor")
    return {"ok": ok}
