"""Tests for admin login + device binding + unbind flow (iteration 8).

Important: These tests share admin credentials and device binding is process-global.
Run sequentially (pytest -p no:xdist) to keep behaviour deterministic.
"""
import os
import uuid
import asyncio
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://gwd-sales-hub.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(username: str, password: str, device_id: str):
    return requests.post(
        f"{API}/auth/login",
        json={"username": username, "password": password, "device_id": device_id},
        timeout=20,
    )


@pytest.fixture(scope="module", autouse=True)
def _reset_admin_bindings():
    """Directly reset bound_device on admin users before running the suite."""
    from pathlib import Path
    env = {}
    for line in Path("/app/backend/.env").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"')
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _reset():
        c = AsyncIOMotorClient(env["MONGO_URL"])
        db = c[env["DB_NAME"]]
        await db.users.update_many(
            {"role": "admin"},
            {"$unset": {"bound_device": "", "bound_device_at": "", "locked_until": ""},
             "$set": {"failed_attempts": 0}},
        )
        c.close()

    asyncio.get_event_loop().run_until_complete(_reset()) if False else asyncio.run(_reset())
    yield


class TestAdminLoginFresh:
    """After unbinding, MOFEED and admin should log in successfully with 18 perms."""

    def test_mofeed_login_ok(self):
        r = _login("MOFEED", "EeFSWtdsFRBmb3p", f"dev-mofeed-{uuid.uuid4()}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["role"] == "admin"
        assert len(d["user"].get("permissions") or []) == 18
        assert d.get("token")

    def test_admin_admin123_ok(self):
        # unbind admin first so this can run independently
        _unbind_via_admin("admin")
        r = _login("admin", "admin123", f"dev-admin-{uuid.uuid4()}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["role"] == "admin"
        assert len(d["user"].get("permissions") or []) == 18


def _unbind_via_admin(target_username: str):
    """Login as MOFEED (assumed unbound) then unbind another user."""
    # Prefer whichever admin is currently unbound; try MOFEED, then admin.
    for uname, pwd in [("MOFEED", "EeFSWtdsFRBmb3p"), ("admin", "admin123"), ("MOF", "admin123")]:
        # Use a fixed device so we don't randomly get bound to noise
        r = _login(uname, pwd, "dev-testctl")
        if r.status_code == 200:
            token = r.json()["token"]
            break
    else:
        pytest.skip("No admin login succeeded to run unbind flow")
    headers = {"Authorization": f"Bearer {token}"}
    ulist = requests.get(f"{API}/users", headers=headers, timeout=20).json()
    tgt = next((u for u in ulist if u.get("username") == target_username), None)
    assert tgt, f"{target_username} not found"
    ub = requests.post(f"{API}/users/{tgt['id']}/unbind-device", headers=headers, timeout=20)
    assert ub.status_code == 200, ub.text


class TestUnbindFlow:
    def test_admin_unbinds_mofeed_then_new_device_login(self):
        _unbind_via_admin("MOFEED")
        r = _login("MOFEED", "EeFSWtdsFRBmb3p", f"dev-postunbind-{uuid.uuid4()}")
        assert r.status_code == 200, f"After unbind, MOFEED must log in: {r.status_code} {r.text}"
        assert r.json()["user"]["role"] == "admin"

    def test_second_device_blocked_without_unbind(self):
        """Documents the current behaviour: without unbind, a second device is blocked.
        Review says admins should NOT be blocked. This test records the deviation.
        """
        _unbind_via_admin("MOFEED")
        d1 = f"dev-bind-{uuid.uuid4()}"
        d2 = f"dev-other-{uuid.uuid4()}"
        r1 = _login("MOFEED", "EeFSWtdsFRBmb3p", d1)
        assert r1.status_code == 200
        r2 = _login("MOFEED", "EeFSWtdsFRBmb3p", d2)
        # Expected per review: 200 (admin exempt). Actual behaviour: 403.
        # Assert the review expectation so the deviation is captured as a FAIL.
        assert r2.status_code == 200, (
            f"REVIEW EXPECTATION: admin must log in from ANY device, but got "
            f"{r2.status_code} {r2.text}. Current server.py enforces device binding "
            f"for admin role at line ~517."
        )


class TestCustomersEndpoint:
    def test_customers_reachable(self):
        _unbind_via_admin("admin")
        r = _login("admin", "admin123", f"dev-cust-{uuid.uuid4()}")
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        rc = requests.get(f"{API}/customers", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert rc.status_code == 200
        assert isinstance(rc.json(), list)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-p", "no:xdist"])
