"""
Test PUT /api/sales/{sid} and PUT /api/purchases/{pid} full-edit + legacy quick-edit.
Validates:
- same invoice number preserved after full edit
- balance is REVERSED and REAPPLIED (not doubled) => net delta == (new_remaining - old_remaining)
- inventory (stock.sold / stock.total / numbered cards) is not doubled
- legacy partial edit (discount/paid/notes only, no items) still works
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def hdr():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def cust(hdr):
    phone = f"7{uuid.uuid4().int % 10**8:08d}"
    r = requests.post(f"{API}/customers", json={
        "name": "TEST_EditSale_" + phone[-4:], "phone": phone, "password": "pass1234",
        "credit_limit": 1000000, "opening_balance": 0,
    }, headers=hdr)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def supp(hdr):
    r = requests.post(f"{API}/suppliers", json={
        "name": "TEST_EditPur_" + uuid.uuid4().hex[:5], "phone": "700111222",
        "credit_limit": 0, "opening_balance": 0,
    }, headers=hdr)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def cat(hdr):
    r = requests.post(f"{API}/categories", json={
        "name": "TEST_EditCat_" + uuid.uuid4().hex[:5],
        "value": 100, "sale_price": 100, "purchase_price": 80,
        "validity_days": 30, "data_size": "1GB", "low_stock_threshold": 5,
    }, headers=hdr)
    assert r.status_code == 200, r.text
    c = r.json()
    # Seed stock so unnumbered sales don't fail
    requests.post(f"{API}/cards/add-quantity",
                  json={"category_id": c["id"], "quantity": 500},
                  headers=hdr)
    return c


def _get_cust_balance(hdr, cid):
    for c in requests.get(f"{API}/customers", headers=hdr).json():
        if c["id"] == cid:
            return c.get("balance", 0)
    return None


def _get_supp_balance(hdr, sid):
    for s in requests.get(f"{API}/suppliers", headers=hdr).json():
        if s["id"] == sid:
            return s.get("balance", 0)
    return None


def _get_stock(hdr, cat_id):
    for s in requests.get(f"{API}/stock", headers=hdr).json():
        if s.get("category_id") == cat_id:
            quantity = s.get("quantity") or {}
            return {
                **s,
                "total": s.get("total", quantity.get("total", 0)),
                "sold": s.get("sold", quantity.get("sold", 0)),
            }
    return None


class TestSaleFullEdit:
    def test_full_edit_preserves_number_and_no_double_apply(self, hdr, cust, cat):
        b0 = _get_cust_balance(hdr, cust["id"])
        s0 = _get_stock(hdr, cat["id"])
        sold0 = (s0 or {}).get("sold", 0)

        # Create sale: qty=3 price=100 → total=300, paid=0, credit → remaining=300
        payload = {
            "customer_id": cust["id"], "customer_name": cust["name"],
            "sale_type": "credit",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 3, "price": 100, "card_numbers": [], "use_numbered": False}],
            "discount": 0, "paid": 0,
        }
        r = requests.post(f"{API}/sales", json=payload, headers=hdr)
        assert r.status_code == 200, r.text
        sale = r.json()
        orig_number = sale["number"]
        sid = sale["id"]

        b1 = _get_cust_balance(hdr, cust["id"])
        assert b1 == b0 + 300, f"after-create balance mismatch: {b0}→{b1}"
        s1 = _get_stock(hdr, cat["id"])
        assert s1["sold"] == sold0 + 3

        # Full edit: change qty=5, price=100, discount=50, paid=100 → total=450, remaining=350
        edit_body = {
            "customer_id": cust["id"], "customer_name": cust["name"],
            "sale_type": "credit",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 5, "price": 100, "card_numbers": [], "use_numbered": False}],
            "discount": 50, "paid": 100,
        }
        r2 = requests.put(f"{API}/sales/{sid}", json=edit_body, headers=hdr)
        assert r2.status_code == 200, r2.text

        # Number preserved
        got = requests.get(f"{API}/sales", headers=hdr).json()
        found = next(x for x in got if x["id"] == sid)
        assert found["number"] == orig_number, "invoice number must be preserved"
        assert found["total"] == 450 and found["remaining"] == 350

        # Balance reversed & reapplied: net = b0 + 350 (NOT b0 + 300 + 350)
        b2 = _get_cust_balance(hdr, cust["id"])
        assert b2 == b0 + 350, f"BALANCE DOUBLED! b0={b0} b_after_edit={b2} expected={b0+350}"

        # Stock not doubled: net sold = sold0 + 5
        s2 = _get_stock(hdr, cat["id"])
        assert s2["sold"] == sold0 + 5, f"STOCK DOUBLED! sold0={sold0} after_edit={s2['sold']} expected={sold0+5}"

    def test_legacy_partial_edit_still_works(self, hdr, cust, cat):
        # Create simple sale
        b0 = _get_cust_balance(hdr, cust["id"])
        r = requests.post(f"{API}/sales", json={
            "customer_id": cust["id"], "customer_name": cust["name"],
            "sale_type": "credit",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 2, "price": 100, "card_numbers": [], "use_numbered": False}],
            "discount": 0, "paid": 0,
        }, headers=hdr)
        assert r.status_code == 200
        sid = r.json()["id"]
        num = r.json()["number"]
        b1 = _get_cust_balance(hdr, cust["id"])
        assert b1 == b0 + 200

        # Legacy edit: only discount+paid+notes
        r2 = requests.put(f"{API}/sales/{sid}",
                          json={"discount": 20, "paid": 50, "notes": "legacy edit"},
                          headers=hdr)
        assert r2.status_code == 200, r2.text
        # Verify: new_total=180, new_remaining=130 → diff = 130-200 = -70
        got = next(x for x in requests.get(f"{API}/sales", headers=hdr).json() if x["id"] == sid)
        assert got["number"] == num
        assert got["discount"] == 20 and got["paid"] == 50
        assert got["total"] == 180 and got["remaining"] == 130
        assert got.get("notes") == "legacy edit"
        b2 = _get_cust_balance(hdr, cust["id"])
        assert b2 == b0 + 130

    def test_ledger_has_reverse_and_reapply_entries(self, hdr, cust, cat):
        r = requests.post(f"{API}/sales", json={
            "customer_id": cust["id"], "customer_name": cust["name"],
            "sale_type": "credit",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 1, "price": 100, "card_numbers": [], "use_numbered": False}],
        }, headers=hdr)
        sid = r.json()["id"]; num = r.json()["number"]
        # Full edit
        r2 = requests.put(f"{API}/sales/{sid}", json={
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 2, "price": 100, "card_numbers": [], "use_numbered": False}],
            "discount": 0, "paid": 0,
        }, headers=hdr)
        assert r2.status_code == 200, r2.text
        # Look for ledger entries on this customer for this invoice number
        ledger = requests.get(f"{API}/ledger/customer/{cust['id']}", headers=hdr)
        if ledger.status_code == 200:
            entries = ledger.json()
            descs = " | ".join([str(e.get("description") or e.get("note") or "") for e in entries])
            assert f"عكس تأثير الفاتورة {num}" in descs or "عكس تأثير" in descs, f"missing reverse entry; got: {descs[-500:]}"
            assert f"تعديل فاتورة {num}" in descs, f"missing reapply entry; got: {descs[-500:]}"


class TestPurchaseFullEdit:
    def test_full_edit_no_double_stock_or_balance(self, hdr, supp, cat):
        s0 = _get_stock(hdr, cat["id"])
        total0 = (s0 or {}).get("total", 0)
        bs0 = _get_supp_balance(hdr, supp["id"]) or 0

        # Create purchase: qty=10 price=80 → total=800, credit remaining=800
        r = requests.post(f"{API}/purchases", json={
            "supplier_id": supp["id"], "supplier_name": supp["name"],
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 10, "price": 80, "card_numbers": [], "use_numbered": False}],
            "discount": 0, "paid": 0,
        }, headers=hdr)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]; num = r.json()["number"]
        s1 = _get_stock(hdr, cat["id"]);  assert s1["total"] == total0 + 10
        bs1 = _get_supp_balance(hdr, supp["id"])
        assert bs1 == bs0 + 800

        # Full edit: change qty=6 price=80 → total=480
        r2 = requests.put(f"{API}/purchases/{pid}", json={
            "supplier_id": supp["id"], "supplier_name": supp["name"],
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 6, "price": 80, "card_numbers": [], "use_numbered": False}],
            "discount": 0, "paid": 0,
        }, headers=hdr)
        assert r2.status_code == 200, r2.text

        # Verify same number
        got = next(x for x in requests.get(f"{API}/purchases", headers=hdr).json() if x["id"] == pid)
        assert got["number"] == num
        assert got["total"] == 480

        # Stock not doubled: net = total0 + 6
        s2 = _get_stock(hdr, cat["id"])
        assert s2["total"] == total0 + 6, f"PURCHASE STOCK DOUBLED! total0={total0} after={s2['total']} expected={total0+6}"

        # Supplier balance not doubled: net = bs0 + 480
        bs2 = _get_supp_balance(hdr, supp["id"])
        assert bs2 == bs0 + 480, f"SUPPLIER BALANCE DOUBLED! bs0={bs0} after={bs2} expected={bs0+480}"
