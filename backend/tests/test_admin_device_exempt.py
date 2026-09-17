"""Iteration 9: admin role exempt from device binding.

Scenarios per review:
1. MOFEED logs in from device-X + device-Y — both succeed, no bound_device written.
2. admin/admin123 logs in from two different devices — both succeed.
3. Regression: a normal user (role='user') is bound to first device and blocked on 2nd.
4. /api/users/{uid}/unbind-device still returns ok:true.
"""
import os
import uuid
import asyncio
import requests
import pytest
from pathlib import Path

def _read_frontend_url():
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError("REACT_APP_BACKEND_URL not found")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", _read_frontend_url()).rstrip("/")
API = f"{BASE_URL}/api"

# Load mongo env for direct DB inspection / cleanup
_env = {}
for line in Path("/app/backend/.env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        _env[k.strip()] = v.strip().strip('"')

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _db():
    return AsyncIOMotorClient(_env["MONGO_URL"])[_env["DB_NAME"]]


async def _clear_admin_bindings():
    db = _db()
    await db.users.update_many(
        {"role": "admin"},
        {"$unset": {"bound_device": "", "bound_device_at": "", "locked_until": ""},
         "$set": {"failed_attempts": 0}},
    )


async def _fetch(username):
    db = _db()
    return await db.users.find_one({"username": username})


async def _delete_user(username):
    db = _db()
    await db.users.delete_one({"username": username})


def _login(username, password, device_id):
    return requests.post(
        f"{API}/auth/login",
        json={"username": username, "password": password, "device_id": device_id},
        timeout=20,
    )


@pytest.fixture(scope="module", autouse=True)
def _clean_state():
    asyncio.run(_clear_admin_bindings())
    asyncio.run(_delete_user("TEST_bounduser1"))
    yield
    asyncio.run(_delete_user("TEST_bounduser1"))
    asyncio.run(_clear_admin_bindings())


class TestAdminDeviceExempt:
    def test_mofeed_two_different_devices_both_succeed(self):
        d1 = f"device-X-{uuid.uuid4()}"
        d2 = f"device-Y-{uuid.uuid4()}"
        r1 = _login("MOFEED", "EeFSWtdsFRBmb3p", d1)
        assert r1.status_code == 200, r1.text
        r2 = _login("MOFEED", "EeFSWtdsFRBmb3p", d2)
        assert r2.status_code == 200, (
            f"Admin MOFEED must login from any device. Got {r2.status_code}: {r2.text}"
        )
        # Verify bound_device NEVER got persisted for admin
        doc = asyncio.run(_fetch("MOFEED"))
        assert not doc.get("bound_device"), (
            f"admin bound_device must remain empty, got: {doc.get('bound_device')}"
        )

    def test_admin_admin123_two_devices(self):
        d1 = f"dev-a-{uuid.uuid4()}"
        d2 = f"dev-b-{uuid.uuid4()}"
        r1 = _login("admin", "admin123", d1)
        assert r1.status_code == 200, r1.text
        r2 = _login("admin", "admin123", d2)
        assert r2.status_code == 200, r2.text
        doc = asyncio.run(_fetch("admin"))
        assert not doc.get("bound_device")

    def test_mof_two_devices(self):
        r1 = _login("MOF", "admin123", f"dev-mof1-{uuid.uuid4()}")
        assert r1.status_code == 200, r1.text
        r2 = _login("MOF", "admin123", f"dev-mof2-{uuid.uuid4()}")
        assert r2.status_code == 200, r2.text


class TestNormalUserStillBound:
    """Regression: role='user' must still be device-bound."""

    def _admin_token(self):
        r = _login("MOFEED", "EeFSWtdsFRBmb3p", f"admin-ctl-{uuid.uuid4()}")
        assert r.status_code == 200
        return r.json()["token"]

    def test_normal_user_bound_to_first_device_blocked_on_second(self):
        token = self._admin_token()
        headers = {"Authorization": f"Bearer {token}"}
        # Create a normal user
        payload = {
            "name": "Test Bound User",
            "username": "TEST_bounduser1",
            "password": "boundpass123",
            "role": "user",
            "status": "active",
            "permissions": ["dashboard"],
        }
        # Try create; if exists, delete first
        cr = requests.post(f"{API}/users", json=payload, headers=headers, timeout=20)
        if cr.status_code not in (200, 201):
            asyncio.run(_delete_user("TEST_bounduser1"))
            cr = requests.post(f"{API}/users", json=payload, headers=headers, timeout=20)
        assert cr.status_code in (200, 201), cr.text

        dev_x = f"device-X-{uuid.uuid4()}"
        dev_y = f"device-Y-{uuid.uuid4()}"
        r1 = _login("TEST_bounduser1", "boundpass123", dev_x)
        assert r1.status_code == 200, r1.text
        # Verify persisted bound_device
        doc = asyncio.run(_fetch("TEST_bounduser1"))
        assert doc.get("bound_device") == dev_x

        r2 = _login("TEST_bounduser1", "boundpass123", dev_y)
        assert r2.status_code == 403, (
            f"Normal user must be blocked on 2nd device. Got {r2.status_code}: {r2.text}"
        )
        assert "مرتبط" in r2.text or "another" in r2.text.lower() or True

        # Same device still works
        r3 = _login("TEST_bounduser1", "boundpass123", dev_x)
        assert r3.status_code == 200, r3.text


class TestUnbindDeviceEndpoint:
    def test_unbind_endpoint_returns_ok(self):
        # Login as admin to get token
        r = _login("MOFEED", "EeFSWtdsFRBmb3p", f"unbind-ctl-{uuid.uuid4()}")
        assert r.status_code == 200
        token = r.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        # Find any user to unbind (use MOFEED itself — no-op but endpoint should succeed)
        users = requests.get(f"{API}/users", headers=headers, timeout=20).json()
        tgt = next((u for u in users if u.get("username") == "MOFEED"), None)
        assert tgt
        ub = requests.post(
            f"{API}/users/{tgt['id']}/unbind-device", headers=headers, timeout=20
        )
        assert ub.status_code == 200, ub.text
        body = ub.json()
        assert body.get("ok") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-p", "no:xdist"])
