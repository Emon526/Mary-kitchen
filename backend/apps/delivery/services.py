"""Delivery zone resolution and fee calculation."""
from decimal import Decimal

from django.conf import settings
from geopy.distance import geodesic

from .models import DeliveryZone

# Surcharge for addresses outside all zone bands when outside_zone_behaviour is "allow".
_OUTSIDE_ALLOW_SURCHARGE = Decimal("1.20")


def calculate_distance_km(lat: float, lng: float) -> float:
    """Calculate straight-line distance in km from store to given coordinates."""
    store = (settings.STORE_LATITUDE, settings.STORE_LONGITUDE)
    destination = (lat, lng)
    return geodesic(store, destination).km


def _fee_response(
    *,
    available: bool,
    reason: str | None,
    fee: Decimal,
    zone,
    zone_name: str | None,
    zone_id: str | None,
    distance_km: float | None,
    estimated_days: int | None,
    is_free: bool,
) -> dict:
    """Uniform shape for all get_delivery_fee return paths."""
    return {
        "available": available,
        "reason": reason,
        "fee": fee,
        "zone": zone,
        "zone_name": zone_name,
        "zone_id": zone_id,
        "distance_km": distance_km,
        "estimated_days": estimated_days,
        "is_free": is_free,
    }


def get_delivery_fee(lat: float, lng: float, order_total: Decimal) -> dict:
    """
    Resolve delivery zone and fee from store to (lat, lng), honouring
    ``outside_zone_behaviour`` on the outermost active zone when the address
    falls outside every band.
    """
    active = DeliveryZone.objects.filter(is_active=True)
    if not active.exists():
        return _fee_response(
            available=False,
            reason="Delivery is not configured yet",
            fee=Decimal("0.00"),
            zone=None,
            zone_name=None,
            zone_id=None,
            distance_km=None,
            estimated_days=None,
            is_free=False,
        )

    distance = calculate_distance_km(lat, lng)
    distance_km = round(distance, 2)

    zone = (
        active.filter(
            min_distance_km__lte=distance,
            max_distance_km__gte=distance,
        )
        .order_by("min_distance_km")
        .first()
    )

    if zone:
        is_free = bool(
            zone.free_delivery_threshold and order_total >= zone.free_delivery_threshold
        )
        fee = Decimal("0.00") if is_free else zone.delivery_fee
        return _fee_response(
            available=True,
            reason=None,
            fee=fee,
            zone=zone,
            zone_name=zone.name,
            zone_id=str(zone.id),
            distance_km=distance_km,
            estimated_days=zone.estimated_delivery_days,
            is_free=is_free,
        )

    outermost = active.order_by("-max_distance_km").first()
    behaviour = outermost.outside_zone_behaviour

    if behaviour == "deny":
        return _fee_response(
            available=False,
            reason="Delivery is not available in your area",
            fee=Decimal("0.00"),
            zone=None,
            zone_name=None,
            zone_id=None,
            distance_km=distance_km,
            estimated_days=None,
            is_free=False,
        )

    if behaviour == "contact":
        return _fee_response(
            available=False,
            reason="Delivery not available. Please contact the store",
            fee=Decimal("0.00"),
            zone=None,
            zone_name=None,
            zone_id=None,
            distance_km=distance_km,
            estimated_days=None,
            is_free=False,
        )

    if behaviour == "allow":
        fee = (outermost.delivery_fee * _OUTSIDE_ALLOW_SURCHARGE).quantize(Decimal("0.01"))
        return _fee_response(
            available=True,
            reason=None,
            fee=fee,
            zone=None,
            zone_name="Extended area",
            zone_id=None,
            distance_km=distance_km,
            estimated_days=outermost.estimated_delivery_days + 1,
            is_free=False,
        )

    # Unknown choice — treat as deny (defensive)
    return _fee_response(
        available=False,
        reason="Delivery is not available in your area",
        fee=Decimal("0.00"),
        zone=None,
        zone_name=None,
        zone_id=None,
        distance_km=distance_km,
        estimated_days=None,
        is_free=False,
    )
