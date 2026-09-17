"""
Backend tests for /api/public/card-order/login and admin auth isolation.
Covers cases from iteration 5 review request.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "admin"
ADMIN_PASS = "admin123"
CUST_PHONE = "777777777"
CUST_PASS = "test1234"
UNKNOWN_PHONE_1 = "888888888"
UNKNOWN_PHONE_2 = "999999999999"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def unblock(phone, headers):
    try:
        requests.post(f"{API}/public-blocks/{phone}/unblock", headers=headers, timeout=10)
    except Exception:
        pass


@pytest.fixture(autouse=True)
def cleanup_blocks(admin_headers):
    # Pre-clean
    for p in [CUST_PHONE, UNKNOWN_PHONE_1, UNKNOWN_PHONE_2]:
        unblock(p, admin_headers)
    yield
    for p in [CUST_PHONE, UNKNOWN_PHONE_1, UNKNOWN_PHONE_2]:
        unblock(p, admin_headers)


# ---- Case 9 Regression: admin login works ----
def test_admin_login_works():
    r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200
    data = r.json()
    assert "token" in data


# ---- Case 8: admin API without token returns 401 ----
def test_admin_api_requires_auth():
    r = requests.get(f"{API}/customers")
    assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"


# ---- Case 10 backend: /public/card-order/login response codes ----
def test_public_login_success():
    r = requests.post(f"{API}/public/card-order/login", json={"phone": CUST_PHONE, "password": CUST_PASS})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["phone"] == CUST_PHONE
    assert "credit_limit" in data
    assert "balance" in data
    assert "available" in data


def test_public_login_wrong_password_401():
    r = requests.post(f"{API}/public/card-order/login", json={"phone": CUST_PHONE, "password": "wrong-xxxx"})
    assert r.status_code == 401, f"Expected 401, got {r.status_code} {r.text}"


def test_public_login_not_found_404():
    r = requests.post(f"{API}/public/card-order/login", json={"phone": UNKNOWN_PHONE_2, "password": "whatever"})
    assert r.status_code == 404, f"Expected 404, got {r.status_code} {r.text}"


# ---- Case 5: 5 failed attempts on existing customer -> blocked 429 ----
def test_customer_blocked_after_5_failures(admin_headers):
    # Ensure clean
    unblock(CUST_PHONE, admin_headers)
    last = None
    for i in range(5):
        last = requests.post(f"{API}/public/card-order/login", json={"phone": CUST_PHONE, "password": "wrong-xxxx"})
        # First 4 should be 401, 5th should trigger block (may return 401 while blocking on this attempt)
    # Now next attempt must be 429
    r = requests.post(f"{API}/public/card-order/login", json={"phone": CUST_PHONE, "password": CUST_PASS})
    assert r.status_code == 429, f"Expected 429 block, got {r.status_code} {r.text} (last failed: {last.status_code if last else 'n/a'})"

    # Verify via admin GET /api/public-blocks
    blk = requests.get(f"{API}/public-blocks", headers=admin_headers)
    assert blk.status_code == 200
    phones = [b.get("phone") for b in blk.json()]
    assert CUST_PHONE in phones, f"Blocked phone not present: {phones}"

    # Cleanup
    ub = requests.post(f"{API}/public-blocks/{CUST_PHONE}/unblock", headers=admin_headers)
    assert ub.status_code in (200, 204)


# ---- Case 6: 5 failed attempts on unknown phone -> blocked ----
def test_unknown_phone_blocked_after_5_failures(admin_headers):
    unblock(UNKNOWN_PHONE_1, admin_headers)
    for i in range(5):
        requests.post(f"{API}/public/card-order/login", json={"phone": UNKNOWN_PHONE_1, "password": "x"})
    r = requests.post(f"{API}/public/card-order/login", json={"phone": UNKNOWN_PHONE_1, "password": "x"})
    assert r.status_code == 429, f"Expected 429 block for unknown phone, got {r.status_code}"
    # cleanup
    requests.post(f"{API}/public-blocks/{UNKNOWN_PHONE_1}/unblock", headers=admin_headers)
