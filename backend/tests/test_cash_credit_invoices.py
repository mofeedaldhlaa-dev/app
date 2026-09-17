"""Regression coverage for cash/credit sales and purchases.

The test verifies that cash invoices affect only the cash box, credit invoices
affect only the linked party account, idempotent retries do not duplicate an
invoice or ledger entry, and changing an invoice type reverses/reapplies the
correct financial effect exactly once.
"""
import os
import uuid

import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as env_file:
        for line in env_file:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _login():
    response = requests.post(
        f"{API}/auth/login",
        json={"username": "admin", "password": "admin123"},
        timeout=30,
    )
    assert response.status_code == 200, response.text
    return {
        "Authorization": f"Bearer {response.json()['token']}",
        "Content-Type": "application/json",
    }


def _party_balance(headers, collection, party_id):
    response = requests.get(f"{API}/{collection}", headers=headers, timeout=30)
    response.raise_for_status()
    return next(item for item in response.json() if item["id"] == party_id)["balance"]


def _statement_entries(headers, party_type, party_id, number):
    response = requests.get(
        f"{API}/accounts/{party_type}/{party_id}/statement",
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    return [entry for entry in response.json()["entries"] if entry.get("number") == number]


def _cash_balance(headers):
    response = requests.get(f"{API}/cash/summary", headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()["balance"]


def test_cash_credit_invoice_accounting_and_idempotency():
    headers = _login()
    suffix = uuid.uuid4().hex[:8]
    created = {"sales": [], "purchases": [], "customers": [], "suppliers": [], "categories": []}

    try:
        customer_response = requests.post(
            f"{API}/customers",
            json={
                "name": f"TEST_CASH_CREDIT_CUSTOMER_{suffix}",
                "phone": f"7{uuid.uuid4().int % 10**8:08d}",
                "password": "pass1234",
                "credit_limit": 1000000,
                "opening_balance": 0,
            },
            headers=headers,
            timeout=30,
        )
        assert customer_response.status_code == 200, customer_response.text
        customer = customer_response.json()
        created["customers"].append(customer["id"])

        supplier_response = requests.post(
            f"{API}/suppliers",
            json={
                "name": f"TEST_CASH_CREDIT_SUPPLIER_{suffix}",
                "phone": f"7{uuid.uuid4().int % 10**8:08d}",
                "credit_limit": 1000000,
                "opening_balance": 0,
            },
            headers=headers,
            timeout=30,
        )
        assert supplier_response.status_code == 200, supplier_response.text
        supplier = supplier_response.json()
        created["suppliers"].append(supplier["id"])

        category_response = requests.post(
            f"{API}/categories",
            json={
                "name": f"TEST_CASH_CREDIT_CATEGORY_{suffix}",
                "value": 100,
                "sale_price": 100,
                "purchase_price": 80,
                "validity_days": 30,
                "data_size": "1GB",
                "low_stock_threshold": 1,
            },
            headers=headers,
            timeout=30,
        )
        assert category_response.status_code == 200, category_response.text
        category = category_response.json()
        created["categories"].append(category["id"])
        stock_response = requests.post(
            f"{API}/cards/add-quantity",
            json={"category_id": category["id"], "quantity": 50},
            headers=headers,
            timeout=30,
        )
        assert stock_response.status_code == 200, stock_response.text

        customer_start = _party_balance(headers, "customers", customer["id"])
        supplier_start = _party_balance(headers, "suppliers", supplier["id"])
        cash_start = _cash_balance(headers)

        sale_item = {
            "category_id": category["id"],
            "category_name": category["name"],
            "quantity": 1,
            "price": 100,
            "card_numbers": [],
            "use_numbered": False,
        }

        cash_sale_key = str(uuid.uuid4())
        cash_sale_payload = {
            "customer_id": customer["id"],
            "customer_name": customer["name"],
            "sale_type": "cash",
            "items": [sale_item],
            "discount": 0,
            "paid": 0,
            "idempotency_key": cash_sale_key,
        }
        cash_sale_response = requests.post(f"{API}/sales", json=cash_sale_payload, headers=headers, timeout=30)
        assert cash_sale_response.status_code == 200, cash_sale_response.text
        cash_sale = cash_sale_response.json()
        created["sales"].append(cash_sale["id"])
        assert cash_sale["paid"] == 100
        assert cash_sale["remaining"] == 0
        assert _party_balance(headers, "customers", customer["id"]) == customer_start
        assert _statement_entries(headers, "customer", customer["id"], cash_sale["number"]) == []
        assert _cash_balance(headers) == cash_start + 100

        cash_sale_retry = requests.post(f"{API}/sales", json=cash_sale_payload, headers=headers, timeout=30)
        assert cash_sale_retry.status_code == 200, cash_sale_retry.text
        assert cash_sale_retry.json()["id"] == cash_sale["id"]
        assert _cash_balance(headers) == cash_start + 100

        credit_sale_key = str(uuid.uuid4())
        credit_sale_payload = {
            **cash_sale_payload,
            "sale_type": "credit",
            "idempotency_key": credit_sale_key,
        }
        credit_sale_response = requests.post(f"{API}/sales", json=credit_sale_payload, headers=headers, timeout=30)
        assert credit_sale_response.status_code == 200, credit_sale_response.text
        credit_sale = credit_sale_response.json()
        created["sales"].append(credit_sale["id"])
        assert credit_sale["remaining"] == 100
        assert _party_balance(headers, "customers", customer["id"]) == customer_start + 100
        assert len(_statement_entries(headers, "customer", customer["id"], credit_sale["number"])) == 1
        assert _cash_balance(headers) == cash_start + 100

        credit_sale_retry = requests.post(f"{API}/sales", json=credit_sale_payload, headers=headers, timeout=30)
        assert credit_sale_retry.status_code == 200, credit_sale_retry.text
        assert credit_sale_retry.json()["id"] == credit_sale["id"]
        assert _party_balance(headers, "customers", customer["id"]) == customer_start + 100
        assert len(_statement_entries(headers, "customer", customer["id"], credit_sale["number"])) == 1

        sale_to_cash = requests.put(
            f"{API}/sales/{credit_sale['id']}",
            json={
                "customer_id": customer["id"],
                "customer_name": customer["name"],
                "sale_type": "cash",
                "items": [sale_item],
                "discount": 0,
                "paid": 0,
            },
            headers=headers,
            timeout=30,
        )
        assert sale_to_cash.status_code == 200, sale_to_cash.text
        assert sale_to_cash.json()["sale_type"] == "cash"
        assert sale_to_cash.json()["remaining"] == 0
        assert _party_balance(headers, "customers", customer["id"]) == customer_start
        assert _statement_entries(headers, "customer", customer["id"], credit_sale["number"]) == []
        assert _cash_balance(headers) == cash_start + 200

        purchase_item = {
            "category_id": category["id"],
            "category_name": category["name"],
            "quantity": 1,
            "price": 80,
            "card_numbers": [],
            "use_numbered": False,
        }

        cash_purchase_key = str(uuid.uuid4())
        cash_purchase_payload = {
            "supplier_id": supplier["id"],
            "supplier_name": supplier["name"],
            "purchase_type": "cash",
            "items": [purchase_item],
            "discount": 0,
            "paid": 0,
            "idempotency_key": cash_purchase_key,
        }
        cash_purchase_response = requests.post(f"{API}/purchases", json=cash_purchase_payload, headers=headers, timeout=30)
        assert cash_purchase_response.status_code == 200, cash_purchase_response.text
        cash_purchase = cash_purchase_response.json()
        created["purchases"].append(cash_purchase["id"])
        assert cash_purchase["paid"] == 80
        assert cash_purchase["remaining"] == 0
        assert _party_balance(headers, "suppliers", supplier["id"]) == supplier_start
        assert _statement_entries(headers, "supplier", supplier["id"], cash_purchase["number"]) == []
        assert _cash_balance(headers) == cash_start + 120

        cash_purchase_retry = requests.post(f"{API}/purchases", json=cash_purchase_payload, headers=headers, timeout=30)
        assert cash_purchase_retry.status_code == 200, cash_purchase_retry.text
        assert cash_purchase_retry.json()["id"] == cash_purchase["id"]
        assert _cash_balance(headers) == cash_start + 120

        credit_purchase_key = str(uuid.uuid4())
        credit_purchase_payload = {
            **cash_purchase_payload,
            "purchase_type": "credit",
            "idempotency_key": credit_purchase_key,
        }
        credit_purchase_response = requests.post(f"{API}/purchases", json=credit_purchase_payload, headers=headers, timeout=30)
        assert credit_purchase_response.status_code == 200, credit_purchase_response.text
        credit_purchase = credit_purchase_response.json()
        created["purchases"].append(credit_purchase["id"])
        assert credit_purchase["remaining"] == 80
        assert _party_balance(headers, "suppliers", supplier["id"]) == supplier_start + 80
        assert len(_statement_entries(headers, "supplier", supplier["id"], credit_purchase["number"])) == 1
        assert _cash_balance(headers) == cash_start + 120

        credit_purchase_retry = requests.post(f"{API}/purchases", json=credit_purchase_payload, headers=headers, timeout=30)
        assert credit_purchase_retry.status_code == 200, credit_purchase_retry.text
        assert credit_purchase_retry.json()["id"] == credit_purchase["id"]
        assert _party_balance(headers, "suppliers", supplier["id"]) == supplier_start + 80
        assert len(_statement_entries(headers, "supplier", supplier["id"], credit_purchase["number"])) == 1

        purchase_to_cash = requests.put(
            f"{API}/purchases/{credit_purchase['id']}",
            json={
                "supplier_id": supplier["id"],
                "supplier_name": supplier["name"],
                "purchase_type": "cash",
                "items": [purchase_item],
                "discount": 0,
                "paid": 0,
            },
            headers=headers,
            timeout=30,
        )
        assert purchase_to_cash.status_code == 200, purchase_to_cash.text
        assert purchase_to_cash.json()["purchase_type"] == "cash"
        assert purchase_to_cash.json()["remaining"] == 0
        assert _party_balance(headers, "suppliers", supplier["id"]) == supplier_start
        assert _statement_entries(headers, "supplier", supplier["id"], credit_purchase["number"]) == []
        assert _cash_balance(headers) == cash_start + 40

        cash_statement = requests.get(f"{API}/cash/statement", headers=headers, timeout=30)
        cash_statement.raise_for_status()
        movements = {entry["number"]: entry for entry in cash_statement.json()["entries"]}
        assert movements[cash_sale["number"]]["in"] == 100
        assert movements[credit_sale["number"]]["in"] == 100
        assert movements[cash_purchase["number"]]["out"] == 80
        assert movements[credit_purchase["number"]]["out"] == 80

    finally:
        for sale_id in reversed(created["sales"]):
            requests.delete(f"{API}/sales/{sale_id}", headers=headers, timeout=30)
        for purchase_id in reversed(created["purchases"]):
            requests.delete(f"{API}/purchases/{purchase_id}", headers=headers, timeout=30)
        for category_id in reversed(created["categories"]):
            requests.delete(f"{API}/categories/{category_id}", headers=headers, timeout=30)
        for customer_id in reversed(created["customers"]):
            requests.delete(f"{API}/customers/{customer_id}", headers=headers, timeout=30)
        for supplier_id in reversed(created["suppliers"]):
            requests.delete(f"{API}/suppliers/{supplier_id}", headers=headers, timeout=30)
