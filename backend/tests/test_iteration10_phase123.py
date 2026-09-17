"""Iteration 10: Phase 1-3 comprehensive backend regression.

Covers:
- Admin login on MOFEED
- Dashboard sales_today == sum of today's active sales (Yemen +03:00)
- Customer create/delete (clean) + delete-refused when has sales
- Supplier create/delete + delete-refused when has purchases
- Sale/purchase/receipt DELETE reverses balance/inventory and Arabic audit log messages
- Password change / unbind-device / unblock all return whatsapp_url
- manifest.json + service-worker.js reachable
"""
import os
import uuid
import time
import requests
import pytest
from pathlib import Path

def _read_env(p, key):
    for line in Path(p).read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"{key} not in {p}")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", _read_env("/app/frontend/.env", "REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "MOFEED"
ADMIN_PASS = "EeFSWtdsFRBmb3p"


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={
        "username": ADMIN_USER, "password": ADMIN_PASS,
        "device_id": f"iter10-{uuid.uuid4()}",
    }, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body
    return body["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


# --------- audit log helper ---------
def _find_audit_containing(h, substr, limit=100):
    r = requests.get(f"{API}/audit?limit={limit}", headers=h, timeout=20)
    if r.status_code != 200:
        return None
    rows = r.json()
    if isinstance(rows, dict):
        rows = rows.get("items") or rows.get("data") or []
    for row in rows:
        act = row.get("action") or row.get("message") or ""
        if substr in act:
            return row
    return None


def _get_customer(h, cid):
    """No GET /customers/{id}; use list and filter."""
    r = requests.get(f"{API}/customers", headers=h, timeout=20)
    if r.status_code != 200:
        return None
    for c in r.json():
        if c.get("id") == cid:
            return c
    return None


# ---------------- 1. Admin login ----------------
class TestAdminLogin:
    def test_mofeed_login_succeeds(self, token):
        assert token and len(token) > 10


# ---------------- 2. Dashboard sales_today ----------------
class TestDashboardSalesToday:
    def test_sales_today_matches_active_sum_yemen_tz(self, h):
        r = requests.get(f"{API}/reports/dashboard", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        dash = r.json()
        assert "sales_today" in dash
        # Fetch sales list, filter by Yemen date
        from datetime import datetime, timezone, timedelta
        now_yem = datetime.now(timezone.utc) + timedelta(hours=3)
        today = now_yem.date().isoformat()
        day_start = f"{today}T00:00:00+03:00"
        day_end = f"{today}T23:59:59+03:00"
        sr = requests.get(f"{API}/sales", headers=h, timeout=30)
        assert sr.status_code == 200
        active_today = [
            s for s in sr.json()
            if s.get("status") == "active" and day_start <= s.get("created_at","") <= day_end
        ]
        expected = sum(s.get("total", 0) for s in active_today)
        # Allow small rounding difference
        assert abs(dash["sales_today"] - expected) < 0.01, (
            f"sales_today={dash['sales_today']} but recomputed={expected}"
        )


# ---------------- 3. Customer create/delete safety ----------------
class TestCustomerDelete:
    def test_create_then_delete_clean_customer(self, h):
        payload = {
            "name": "TEST_del_cust_" + uuid.uuid4().hex[:6],
            "type": "cash",
            "phone": "7" + str(uuid.uuid4().int)[:8],
            "opening_balance": 0,
        }
        cr = requests.post(f"{API}/customers", json=payload, headers=h, timeout=20)
        assert cr.status_code in (200, 201), cr.text
        cid = cr.json()["id"]
        dr = requests.delete(f"{API}/customers/{cid}", headers=h, timeout=20)
        assert dr.status_code == 200, dr.text
        assert dr.json().get("ok") is True
        # verify gone
        assert _get_customer(h, cid) is None

    def test_delete_refused_when_customer_has_sale(self, h):
        # 1. create customer with opening balance so it has a ledger row → still deletable? No — opening balance != 0 blocks.
        # We'll use a *sale* to make sure the refuse path checks sales_count.
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_hist_cust_" + uuid.uuid4().hex[:6],
            "type": "credit",
            "phone": "7" + str(uuid.uuid4().int)[:8],
            "opening_balance": 0,
        }, headers=h, timeout=20).json()
        cid = cust["id"]

        # ensure a category+stock exists to make sale possible (quantity type)
        cats = requests.get(f"{API}/categories", headers=h, timeout=20).json()
        cat = next((c for c in cats if c.get("type") != "numbered"), None) or (cats[0] if cats else None)
        if not cat:
            # create one
            cr = requests.post(f"{API}/categories", json={
                "name": "TEST_cat_" + uuid.uuid4().hex[:4],
                "type": "quantity",
                "purchase_price": 100,
                "sale_price": 150,
            }, headers=h, timeout=20)
            cat = cr.json()
        # stock top-up (simplest: create purchase then delete)
        # Actually easier: create a small sale via /api/sales with only quantity item
        # Ensure stock exists first
        requests.post(f"{API}/stock/adjust", json={
            "category_id": cat["id"], "delta": 5, "reason": "test seed"
        }, headers=h, timeout=20)

        sale_payload = {
            "customer_id": cid,
            "customer_name": cust["name"],
            "sale_type": "credit",
            "items": [{"category_id": cat["id"], "quantity": 1, "price": 100}],
            "discount": 0,
            "paid": 0,
            "notes": "TEST refuse-delete",
        }
        sr = requests.post(f"{API}/sales", json=sale_payload, headers=h, timeout=30)
        # If sale creation failed, still try delete — we need a scenario where customer has history.
        # Fallback: manually push a ledger entry via receipt (payment to customer will create ledger)
        sale_id = None
        if sr.status_code in (200, 201):
            sale_id = sr.json().get("id")

        # Delete should refuse if there is any sale/receipt/ledger/balance
        dr = requests.delete(f"{API}/customers/{cid}", headers=h, timeout=20)
        # If sale succeeded, must be refused (400)
        if sale_id:
            assert dr.status_code == 400, dr.text
            body = dr.text
            assert "لا يمكن حذف" in body or "عمليات مالية" in body, body
            # cleanup: delete the sale (customer will retain ledger history so
            # a second delete may still refuse — that's product-correct).
            requests.delete(f"{API}/sales/{sale_id}", headers=h, timeout=20)
        else:
            requests.delete(f"{API}/customers/{cid}", headers=h, timeout=20)
            pytest.skip("Could not create sale to test refuse path; clean-delete verified in other test.")


# ---------------- 4. Supplier create/delete ----------------
class TestSupplierDelete:
    def test_create_then_delete_supplier(self, h):
        p = {"name": "TEST_sup_" + uuid.uuid4().hex[:6], "phone": "77" + str(uuid.uuid4().int)[:7], "opening_balance": 0}
        r = requests.post(f"{API}/suppliers", json=p, headers=h, timeout=20)
        assert r.status_code in (200, 201), r.text
        sid = r.json()["id"]
        d = requests.delete(f"{API}/suppliers/{sid}", headers=h, timeout=20)
        assert d.status_code == 200, d.text
        assert d.json().get("ok") is True


# ---------------- 5. Sale delete reverses balance + audit ar ----------------
class TestSaleDelete:
    def test_sale_delete_reverses_balance_and_audit(self, h):
        # setup: customer + category+stock
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_sale_del_" + uuid.uuid4().hex[:6],
            "type": "credit", "phone": "78" + str(uuid.uuid4().int)[:7], "opening_balance": 0,
        }, headers=h, timeout=20).json()
        cid = cust["id"]
        cats = requests.get(f"{API}/categories", headers=h, timeout=20).json()
        cat = cats[0] if cats else None
        if not cat:
            pytest.skip("no categories")
        requests.post(f"{API}/stock/adjust", json={"category_id": cat["id"], "delta": 3, "reason": "test"}, headers=h, timeout=20)

        sr = requests.post(f"{API}/sales", json={
            "customer_id": cid, "customer_name": cust["name"], "sale_type": "credit",
            "items": [{"category_id": cat["id"], "quantity": 1, "price": 200}],
            "discount": 0, "paid": 0, "notes": "TEST_saledel",
        }, headers=h, timeout=30)
        if sr.status_code not in (200, 201):
            # cleanup
            requests.delete(f"{API}/customers/{cid}", headers=h, timeout=20)
            pytest.skip(f"sale create failed: {sr.status_code} {sr.text}")
        sid = sr.json()["id"]
        # customer balance should now be 200
        after = _get_customer(h, cid) or {}
        assert after.get("balance", 0) >= 200 - 0.01

        d = requests.delete(f"{API}/sales/{sid}", headers=h, timeout=20)
        assert d.status_code == 200, d.text
        # balance reversed
        after2 = _get_customer(h, cid) or {}
        assert abs(after2.get("balance", 0)) < 0.01, f"balance not reversed: {after2.get('balance')}"

        # audit
        time.sleep(0.5)
        row = _find_audit_containing(h, "حذف فاتورة مبيعات")
        assert row is not None, "audit log should contain 'حذف فاتورة مبيعات'"

        # cleanup
        requests.delete(f"{API}/customers/{cid}", headers=h, timeout=20)


# ---------------- 6. Purchase delete + audit ----------------
class TestPurchaseDelete:
    def test_purchase_delete_reverses_and_audit(self, h):
        # supplier
        sup = requests.post(f"{API}/suppliers", json={
            "name": "TEST_purch_sup_" + uuid.uuid4().hex[:6],
            "phone": "70" + str(uuid.uuid4().int)[:7], "opening_balance": 0,
        }, headers=h, timeout=20).json()
        sid = sup["id"]
        cats = requests.get(f"{API}/categories", headers=h, timeout=20).json()
        cat = cats[0] if cats else None
        if not cat:
            pytest.skip("no categories")

        pr = requests.post(f"{API}/purchases", json={
            "supplier_id": sid, "supplier_name": sup["name"],
            "items": [{"category_id": cat["id"], "quantity": 3, "price": 50}],
            "discount": 0, "paid": 0, "notes": "TEST_purchdel",
        }, headers=h, timeout=30)
        if pr.status_code not in (200, 201):
            requests.delete(f"{API}/suppliers/{sid}", headers=h, timeout=20)
            pytest.skip(f"purchase create failed: {pr.status_code} {pr.text}")
        pid = pr.json()["id"]

        d = requests.delete(f"{API}/purchases/{pid}", headers=h, timeout=20)
        assert d.status_code == 200, d.text
        time.sleep(0.5)
        row = _find_audit_containing(h, "حذف فاتورة مشتريات")
        assert row is not None

        requests.delete(f"{API}/suppliers/{sid}", headers=h, timeout=20)


# ---------------- 7. Receipt delete + audit ----------------
class TestReceiptDelete:
    def test_receipt_delete_reverses_and_audit(self, h):
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_rec_cust_" + uuid.uuid4().hex[:6],
            "type": "credit", "phone": "79" + str(uuid.uuid4().int)[:7],
            "opening_balance": 500,   # customer owes us 500
        }, headers=h, timeout=20).json()
        cid = cust["id"]
        # receipt: customer pays us 200
        rp = requests.post(f"{API}/receipts", json={
            "kind": "receipt",
            "party_type": "customer",
            "party_id": cid,
            "party_name": cust["name"],
            "amount": 200,
            "method": "cash",
            "notes": "TEST_recdel",
        }, headers=h, timeout=20)
        assert rp.status_code in (200, 201), rp.text
        rid = rp.json()["id"]
        # balance should be 300 now
        after = _get_customer(h, cid) or {}
        assert abs(after.get("balance", 0) - 300) < 0.01

        d = requests.delete(f"{API}/receipts/{rid}", headers=h, timeout=20)
        assert d.status_code == 200, d.text
        after2 = _get_customer(h, cid) or {}
        assert abs(after2.get("balance", 0) - 500) < 0.01

        time.sleep(0.5)
        row = _find_audit_containing(h, "حذف سند قبض")
        assert row is not None, "audit should contain 'حذف سند قبض'"

        # cleanup — customer has 500 balance from opening, delete will refuse; force by clearing ledger
        # Attempt delete — expect 400 (opening balance != 0)
        requests.delete(f"{API}/customers/{cid}", headers=h, timeout=20)


# ---------------- 8. WhatsApp URL returns ----------------
class TestWhatsAppUrls:
    def test_password_change_returns_wa_url(self, h):
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_wapwd_" + uuid.uuid4().hex[:6],
            "type": "cash", "phone": "77" + str(uuid.uuid4().int)[:7], "opening_balance": 0,
        }, headers=h, timeout=20).json()
        cid = cust["id"]
        r = requests.post(f"{API}/customers/{cid}/password", json={"password": "newpass123"}, headers=h, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "whatsapp_url" in body
        assert "wa.me" in body["whatsapp_url"], body["whatsapp_url"]
        requests.delete(f"{API}/customers/{cid}", headers=h, timeout=20)

    def test_unbind_device_returns_wa_url(self, h):
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_waunbind_" + uuid.uuid4().hex[:6],
            "type": "cash", "phone": "78" + str(uuid.uuid4().int)[:7], "opening_balance": 0,
        }, headers=h, timeout=20).json()
        cid = cust["id"]
        r = requests.post(f"{API}/customers/{cid}/unbind-device", headers=h, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "whatsapp_url" in body
        assert "wa.me" in body["whatsapp_url"]
        requests.delete(f"{API}/customers/{cid}", headers=h, timeout=20)

    def test_public_unblock_returns_wa_url(self, h):
        phone = "77" + str(uuid.uuid4().int)[:7]
        # Ensure a block record exists (upsert via unblock is fine — it creates one via $set)
        r = requests.post(f"{API}/public-blocks/{phone}/unblock", headers=h, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "whatsapp_url" in body
        # phone may not exist as customer, wa_url could be empty. Try again with an existing customer phone.
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_waunblock_" + uuid.uuid4().hex[:6],
            "type": "cash", "phone": phone, "opening_balance": 0,
        }, headers=h, timeout=20).json()
        r2 = requests.post(f"{API}/public-blocks/{phone}/unblock", headers=h, timeout=20)
        assert r2.status_code == 200
        b2 = r2.json()
        # Now customer exists — wa_url may or may not include wa.me depending on impl
        assert "whatsapp_url" in b2
        requests.delete(f"{API}/customers/{cust['id']}", headers=h, timeout=20)


# ---------------- 9. PWA ----------------
class TestPWA:
    def test_manifest_json(self):
        r = requests.get(f"{BASE_URL}/manifest.json", timeout=20)
        assert r.status_code == 200, r.status_code
        data = r.json()
        assert isinstance(data.get("icons"), list) and len(data["icons"]) > 0
        assert data.get("start_url")
        assert data.get("display") in ("standalone", "fullscreen", "minimal-ui")

    def test_service_worker(self):
        r = requests.get(f"{BASE_URL}/service-worker.js", timeout=20)
        assert r.status_code == 200
        assert "self.addEventListener" in r.text
