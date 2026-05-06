"""
Tests unitaires — TeamWill FinOps Platform
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import date

# Database de test SQLite en memoire
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

from app.schemas.base import Base
from app.database import get_db
from app.main import app

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(autouse=True)
def setup_db():
    import app.models.cost
    import app.models.anomaly
    import app.schemas.user
    import app.schemas.file
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

client = TestClient(app)


def get_auth_headers():
    """Creer un utilisateur et recuperer le token JWT"""
    client.post("/api/v1/auth/register", json={
        "email": "test@teamwill.com",
        "password": "TestPassword123!",
        "full_name": "Test User"
    })
    response = client.post("/api/v1/auth/login", json={
        "email": "test@teamwill.com",
        "password": "TestPassword123!"
    })
    if response.status_code == 200:
        token = response.json().get("access_token", "")
        return {"Authorization": f"Bearer {token}"}
    return {}


# TESTS HEALTH
class TestHealth:
    def test_health_check_returns_200(self):
        response = client.get("/api/v1/health")
        assert response.status_code == 200

    def test_health_check_returns_healthy(self):
        response = client.get("/api/v1/health")
        data = response.json()
        assert data["status"] == "healthy"

    def test_health_check_returns_app_name(self):
        response = client.get("/api/v1/health")
        data = response.json()
        assert "app" in data
        assert data["app"] is not None

    def test_health_check_returns_version(self):
        response = client.get("/api/v1/health")
        data = response.json()
        assert "version" in data


# TESTS AUTHENTICATION
class TestAuth:
    def test_register_new_user(self):
        response = client.post("/api/v1/auth/register", json={
            "email": "newuser@teamwill.com",
            "password": "SecurePass123!",
            "full_name": "New User"
        })
        assert response.status_code in [200, 201]

    def test_register_duplicate_email_fails(self):
        payload = {
            "email": "duplicate@teamwill.com",
            "password": "SecurePass123!",
            "full_name": "User One"
        }
        client.post("/api/v1/auth/register", json=payload)
        response = client.post("/api/v1/auth/register", json=payload)
        assert response.status_code in [400, 409, 422]

    def test_login_valid_credentials(self):
        client.post("/api/v1/auth/register", json={
            "email": "login@teamwill.com",
            "password": "SecurePass123!",
            "full_name": "Login User"
        })
        response = client.post("/api/v1/auth/login", json={
            "email": "login@teamwill.com",
            "password": "SecurePass123!"
        })
        assert response.status_code == 200
        assert "access_token" in response.json()

    def test_login_invalid_password_fails(self):
        client.post("/api/v1/auth/register", json={
            "email": "badpass@teamwill.com",
            "password": "CorrectPass123!",
            "full_name": "Bad Pass User"
        })
        response = client.post("/api/v1/auth/login", json={
            "email": "badpass@teamwill.com",
            "password": "WrongPassword!"
        })
        assert response.status_code in [400, 401, 422]

    def test_login_unknown_user_fails(self):
        response = client.post("/api/v1/auth/login", json={
            "email": "unknown@teamwill.com",
            "password": "AnyPassword123!"
        })
        assert response.status_code in [400, 401, 422]

    def test_protected_route_without_token_fails(self):
        response = client.get("/api/v1/costs/")
        assert response.status_code in [401, 403]


# TESTS COSTS API
class TestCostsAPI:
    def test_list_costs_authenticated(self):
        headers = get_auth_headers()
        if not headers:
            pytest.skip("Auth not available")
        response = client.get("/api/v1/costs/", headers=headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_create_cost(self):
        headers = get_auth_headers()
        if not headers:
            pytest.skip("Auth not available")
        response = client.post("/api/v1/costs/", headers=headers, json={
            "cost_date": str(date.today()),
            "amount": 150.50,
            "currency": "EUR",
            "service_name": "VPS-SSD-3",
            "source": "OVHcloud"
        })
        assert response.status_code == 201
        data = response.json()
        assert data["service_name"] == "VPS-SSD-3"
        assert data["amount"] == 150.50

    def test_create_cost_invalid_amount_fails(self):
        headers = get_auth_headers()
        if not headers:
            pytest.skip("Auth not available")
        response = client.post("/api/v1/costs/", headers=headers, json={
            "cost_date": str(date.today()),
            "amount": -50.0,
            "currency": "EUR",
            "service_name": "VPS-TEST"
        })
        assert response.status_code == 422

    def test_get_cost_by_id(self):
        headers = get_auth_headers()
        if not headers:
            pytest.skip("Auth not available")
        create = client.post("/api/v1/costs/", headers=headers, json={
            "cost_date": str(date.today()),
            "amount": 99.99,
            "currency": "EUR",
            "service_name": "RISE-3"
        })
        cost_id = create.json()["id"]
        response = client.get(f"/api/v1/costs/{cost_id}", headers=headers)
        assert response.status_code == 200
        assert response.json()["id"] == cost_id

    def test_get_nonexistent_cost_returns_404(self):
        headers = get_auth_headers()
        if not headers:
            pytest.skip("Auth not available")
        response = client.get("/api/v1/costs/99999", headers=headers)
        assert response.status_code == 404

    def test_update_cost(self):
        headers = get_auth_headers()
        if not headers:
            pytest.skip("Auth not available")
        create = client.post("/api/v1/costs/", headers=headers, json={
            "cost_date": str(date.today()),
            "amount": 200.0,
            "currency": "EUR",
            "service_name": "HGR-HCI-i3"
        })
        cost_id = create.json()["id"]
        response = client.put(f"/api/v1/costs/{cost_id}", headers=headers, json={
            "amount": 250.0
        })
        assert response.status_code == 200
        assert response.json()["amount"] == 250.0

    def test_delete_cost(self):
        headers = get_auth_headers()
        if not headers:
            pytest.skip("Auth not available")
        create = client.post("/api/v1/costs/", headers=headers, json={
            "cost_date": str(date.today()),
            "amount": 75.0,
            "currency": "EUR",
            "service_name": "VPS-TO-DELETE"
        })
        cost_id = create.json()["id"]
        response = client.delete(f"/api/v1/costs/{cost_id}", headers=headers)
        assert response.status_code == 204
        get_response = client.get(f"/api/v1/costs/{cost_id}", headers=headers)
        assert get_response.status_code == 404

    def test_list_costs_pagination(self):
        headers = get_auth_headers()
        if not headers:
            pytest.skip("Auth not available")
        for i in range(5):
            client.post("/api/v1/costs/", headers=headers, json={
                "cost_date": str(date.today()),
                "amount": float(i * 10 + 10),
                "currency": "EUR",
                "service_name": f"Service-{i}"
            })
        response = client.get("/api/v1/costs/?limit=3&skip=0", headers=headers)
        assert response.status_code == 200
        assert len(response.json()) <= 3


# TESTS COST MODEL
class TestCostModel:
    def test_cost_record_repr(self):
        from app.models.cost import CostRecord
        cost = CostRecord(
            cost_date=date(2026, 4, 1),
            amount=150.0,
            reference="uuid-test",
            source="OVHcloud"
        )
        assert "OVHcloud" in repr(cost)

    def test_cost_record_default_currency(self):
        from app.models.cost import CostRecord
        cost = CostRecord(
            cost_date=date.today(),
            amount=100.0,
            service_name="VPS-Test"
        )
        assert cost.currency == "EUR" or cost.currency is None

    def test_cost_schema_validation(self):
        from app.schemas.cost import CostCreate
        cost = CostCreate(
            cost_date=date.today(),
            amount=100.0,
            service_name="VPS-Test",
            currency="EUR"
        )
        assert cost.amount == 100.0
        assert cost.service_name == "VPS-Test"

    def test_cost_schema_rejects_negative_amount(self):
        from app.schemas.cost import CostCreate
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            CostCreate(
                cost_date=date.today(),
                amount=-10.0,
                service_name="VPS-Test",
                currency="EUR"
            )


# TESTS CONFIG
class TestConfig:
    def test_settings_loaded(self):
        from app.config import settings
        assert settings.app_name is not None
        assert settings.app_version is not None

    def test_api_prefix(self):
        from app.config import settings
        assert settings.api_prefix.startswith("/")

    def test_database_url_configured(self):
        from app.config import settings
        assert settings.database_url is not None
        assert len(settings.database_url) > 0
