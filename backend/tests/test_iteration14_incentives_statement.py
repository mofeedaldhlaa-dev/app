"""Iteration 14 backend regression.
Covers:
  1. POST /api/customers with incentives_visible=false persists & returns field.
  2. POST /api/public/card-order/incentives -> enabled=false when customer.incentives_visible=false.
  3. POST /api/public/card-order/incentives -> enabled=false when settings.exclude_special_price=true
     AND customer.special_prices_enabled=true.
  4. POST /api/public/card-order/statement returns {customer, entries} with UTC+03:00 day boundary
     when start==end==today (no historical entries expected for a brand new customer).
  5. POST /api/receipts (admin voucher save) returns full receipt object (id, number, balance_after).
  6. GET /api/reports/incentives?kind=pending returns {items, kind='pending', count, total_qty}.
  7. GET /api/reports/incentives?kind=redeemed[&start=&end=] returns {items, kind='redeemed'}.
  8. POST /api/payment-requests message auto-appends bank data (no 'البنك:' prefix)
     and includes debt total + requested amount.
"""
import os
import uuid
from datetime import date

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USERNAME = "MOFEED"
ADMIN_PASSWORD = "EeFSWtdsFRBmb3p"


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={
        "username": ADMIN_USERNAME, "password": ADMIN_PASSWORD, "device_id": "iter14-tester"
    }, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, r.text
    return tok


@pytest.fixture(scope="module")
def H(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _uniq_phone():
    # 9 digit numeric, unique
    return "78" + str(uuid.uuid4().int)[-7:]


@pytest.fixture(scope="module")
def category(H):
    """Ensure at least one category exists; create one if missing."""
    r = requests.get(f"{API}/categories", headers=H, timeout=15)
    assert r.status_code == 200
    cats = r.json()
    if cats:
        return cats[0]
    payload = {"name": f"TEST_CAT_{uuid.uuid4().hex[:6]}", "value": 1000,
               "sale_price": 1000, "purchase_price": 900,
               "sale_price_customer": 1000, "sale_price_pos": 950}
    r = requests.post(f"{API}/categories", headers=H, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def bank_account(H):
    """Ensure at least one active bank in show_in=payment_requests."""
    r = requests.get(f"{API}/bank-accounts", headers=H, params={"show_in": "payment_requests"}, timeout=15)
    assert r.status_code == 200
    banks = r.json()
    if banks:
        return banks[0]
    payload = {
        "bank_name": "TEST_BANK_KREMB",
        "holder_name": "TEST_HOLDER",
        "account_number": "9876543210",
        "details": "TEST_DETAILS",
        "active": True,
        "show_in": ["payment_requests"],
    }
    r = requests.post(f"{API}/bank-accounts", headers=H, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_customer(H, **overrides):
    p = _uniq_phone()
    payload = {
        "name": f"TEST_CUST_{uuid.uuid4().hex[:6]}",
        "phone": p,
        "password": "pw12345",
        "credit_limit": 0,
        "opening_balance": 0,
        "customer_type": "customer",
    }
    payload.update(overrides)
    r = requests.post(f"{API}/customers", headers=H, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json(), payload["password"]


# ---------------- tests ----------------

# 1. incentives_visible persists
def test_1_create_customer_incentives_visible_false_persists(H):
    doc, _pw = _make_customer(H, incentives_visible=False)
    assert doc.get("incentives_visible") is False, doc
    # Verify via GET list (there's no GET by id)
    r = requests.get(f"{API}/customers", headers=H, timeout=15)
    assert r.status_code == 200
    match = next((c for c in r.json() if c["id"] == doc["id"]), None)
    assert match is not None
    assert match.get("incentives_visible") is False

    # Also verify default (True) when omitted
    doc2, _ = _make_customer(H)
    assert doc2.get("incentives_visible") is True


# 2. public incentives returns enabled=false when incentives_visible=false
def test_2_public_incentives_disabled_when_customer_hidden(H):
    doc, pw = _make_customer(H, incentives_visible=False)
    r = requests.post(f"{API}/public/card-order/incentives",
                      json={"phone": doc["phone"], "password": pw}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("enabled") is False, body
    assert body.get("categories") == []


# 3. public incentives returns enabled=false when settings.exclude_special_price + customer.special_prices_enabled
def test_3_public_incentives_disabled_when_exclude_special_price_and_customer_flag(H, category):
    # Turn on customer_enabled + exclude_special_price globally
    r = requests.put(f"{API}/incentive-settings", headers=H, json={
        "customer_enabled": True, "pos_enabled": True, "exclude_special_price": True
    }, timeout=15)
    assert r.status_code == 200, r.text
    settings = r.json()
    assert settings.get("exclude_special_price") is True
    assert settings.get("customer_enabled") is True

    # Create at least one incentive rule so `categories` would be non-empty were incentives enabled
    r = requests.post(f"{API}/incentive-rules", headers=H, json={
        "account_type": "customer", "category_id": category["id"],
        "buy_qty": 10, "reward_qty": 1, "active": True,
    }, timeout=15)
    assert r.status_code == 200, r.text

    # Customer WITH special_prices_enabled=True -> incentives disabled
    doc, pw = _make_customer(H, special_prices_enabled=True)
    r = requests.post(f"{API}/public/card-order/incentives",
                      json={"phone": doc["phone"], "password": pw}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("enabled") is False, body

    # Sanity: a customer WITHOUT special_prices_enabled should get enabled=true (since global on + rules exist)
    doc2, pw2 = _make_customer(H, special_prices_enabled=False)
    r2 = requests.post(f"{API}/public/card-order/incentives",
                       json={"phone": doc2["phone"], "password": pw2}, timeout=15)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2.get("enabled") is True, body2


# 4. public statement with UTC+03:00 day boundary
def test_4_public_statement_day_boundary(H):
    doc, pw = _make_customer(H, opening_balance=500)  # this creates one ledger entry today
    today = date.today().isoformat()
    r = requests.post(f"{API}/public/card-order/statement", json={
        "phone": doc["phone"], "password": pw, "start": today, "end": today,
    }, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "customer" in body and "entries" in body, body
    assert body["customer"]["id"] == doc["id"]
    assert "password" not in body["customer"]
    # entries should only be in [today T00:00+03, today T23:59+03]
    lo = f"{today}T00:00:00+03:00"
    hi = f"{today}T23:59:59+03:00"
    for e in body["entries"]:
        if e.get("id") == "opening":
            continue
        ca = e.get("created_at", "")
        assert lo <= ca <= hi, f"Entry outside window: {ca}"


# 5. POST /api/receipts returns full receipt object
def test_5_admin_receipts_returns_full_object(H):
    doc, _ = _make_customer(H, opening_balance=1000)  # customer owes 1000
    payload = {
        "kind": "receipt",
        "party_type": "customer",
        "party_id": doc["id"],
        "party_name": doc["name"],
        "amount": 250,
        "description": "TEST_VOUCHER",
    }
    r = requests.post(f"{API}/receipts", headers=H, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("id", "number", "kind", "amount", "party_id", "balance_after"):
        assert key in body, f"missing {key}: {body}"
    assert body["kind"] == "receipt"
    assert body["amount"] == 250
    # After a قبض of 250 against 1000 debt, remaining debt -> 750
    assert float(body["balance_after"]) == 750.0


# 6. GET /reports/incentives?kind=pending shape
def test_6_reports_incentives_pending_shape(H):
    r = requests.get(f"{API}/reports/incentives", headers=H, params={"kind": "pending"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("kind") == "pending"
    for k in ("items", "count", "total_qty"):
        assert k in body, body
    assert isinstance(body["items"], list)
    assert isinstance(body["count"], int)
    assert body["count"] == len(body["items"])


# 7. GET /reports/incentives?kind=redeemed with range
def test_7_reports_incentives_redeemed_shape(H):
    today = date.today().isoformat()
    r = requests.get(f"{API}/reports/incentives", headers=H,
                     params={"kind": "redeemed", "start": today, "end": today}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("kind") == "redeemed"
    assert "items" in body and isinstance(body["items"], list)


# 8. Payment request auto-appends bank data + debt total + requested amount + no 'البنك:' prefix
def test_8_payment_request_message_format(H, bank_account):
    doc, _ = _make_customer(H, opening_balance=1500)
    payload = {
        "party_type": "customer",
        "party_id": doc["id"],
        "party_name": doc["name"],
        "amount": 700,
        "method": "whatsapp",
        "message": "TEST_HEADER_NOTE",
        "idempotency_key": f"iter14-{uuid.uuid4().hex[:8]}",
    }
    r = requests.post(f"{API}/payment-requests", headers=H, json=payload, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    msg = body.get("message", "")
    # Required content
    assert "TEST_HEADER_NOTE" in msg, msg
    assert "إجمالي المديونية" in msg, msg
    assert "1,500" in msg, msg
    assert "المبلغ المطلوب سداده" in msg, msg
    assert "700" in msg, msg
    # Bank block appears without "البنك:" prefix
    assert bank_account["bank_name"] in msg, msg
    assert "البنك:" not in msg, f"Should NOT include 'البنك:' prefix. msg=\n{msg}"
    assert "اسم الحساب" in msg
    assert "رقم الحساب" in msg
    assert body.get("amount") == 700
    assert body.get("status") in ("sent", "new")
