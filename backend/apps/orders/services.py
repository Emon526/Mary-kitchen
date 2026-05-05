"""Order creation and management service."""
import logging
from decimal import Decimal

import stripe
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.cart.models import Cart
from apps.delivery.services import get_delivery_fee
from apps.products.models import Product, ProductVariant
from apps.users.models import Address

from .models import Order, OrderItem, OrderStatusHistory

logger = logging.getLogger(__name__)


def abandon_unpaid_pending_checkouts(user) -> None:
    """
    Remove stale unpaid checkout orders so the user can place a new one from the same cart
    without double stock deductions. Expires Stripe Checkout / cancels PaymentIntent when possible.
    """
    qs = Order.objects.filter(
        user=user,
        status="pending",
        payment_status__in=["unpaid", "failed"],
    )
    for order in qs:
        rollback_checkout_order(order)


def rollback_checkout_order(order: Order) -> None:
    """Expire Stripe Checkout if any, cancel PI, restore stock, delete the draft order."""
    stripe.api_key = settings.STRIPE_SECRET_KEY

    if order.stripe_checkout_session_id:
        try:
            stripe.checkout.Session.expire(order.stripe_checkout_session_id)
        except stripe.error.StripeError:
            pass

    if order.stripe_payment_intent_id:
        try:
            stripe.PaymentIntent.cancel(order.stripe_payment_intent_id)
        except stripe.error.StripeError:
            pass

    for item in order.items.select_related("product", "variant"):
        if item.was_out_of_stock:
            continue
        stock_obj: Product | ProductVariant = item.variant if item.variant_id else item.product
        stock_obj.stock_quantity += item.quantity
        stock_obj.save(update_fields=["stock_quantity"])
    order.delete()


@transaction.atomic
def create_order_from_cart(user, order_type: str, address_id=None, notes: str = "", session_id: str = "") -> Order:
    """
    Convert the user's cart into a confirmed Order.
    Reduces stock on in-stock items.
    Flags out-of-stock items but still allows order.
    """
    cart = Cart.objects.prefetch_related("items__product", "items__variant").get(user=user)

    if not cart.items.exists():
        raise ValueError("Cannot checkout with an empty cart.")

    delivery_fee = Decimal("0.00")
    delivery_address_snapshot = None
    zone_name = ""
    distance_km = None

    if order_type == "delivery":
        if not address_id:
            raise ValueError("Delivery address is required for delivery orders.")
        try:
            address = Address.objects.get(id=address_id, user=user)
        except Address.DoesNotExist:
            raise ValueError("Address not found.")

        if not (address.latitude and address.longitude):
            raise ValueError(
                "Delivery address must include a valid location. "
                "Please re-save your address using the address search so we can calculate your delivery fee."
            )

        delivery_address_snapshot = {
            "label": address.label,
            "full_name": address.full_name,
            "phone": address.phone,
            "address_line1": address.address_line1,
            "address_line2": address.address_line2,
            "suburb": address.suburb,
            "state": address.state,
            "postcode": address.postcode,
            "country": address.country,
        }

        subtotal_estimate = cart.subtotal
        fee_result = get_delivery_fee(
            float(address.latitude), float(address.longitude), subtotal_estimate
        )
        if not fee_result.get("available", True):
            raise ValueError(fee_result.get("reason", "Delivery not available to this address."))
        delivery_fee = fee_result.get("fee", Decimal("0.00"))
        zone_name = fee_result.get("zone_name", "")
        distance_km = fee_result.get("distance_km")

    order = Order.objects.create(
        user=user,
        order_type=order_type,
        delivery_address=delivery_address_snapshot,
        delivery_zone_name=zone_name,
        delivery_fee=delivery_fee,
        distance_km=distance_km,
        notes=notes,
        session_id=session_id or None,
        payment_status="unpaid",
        status="pending",
    )

    has_oos = False
    excluded_names = []

    for item in cart.items.select_related("product", "variant"):
        product = item.product
        variant = item.variant

        # Skip inactive or deleted products — never order unavailable items
        if not product.is_active or (variant and not variant.is_active):
            excluded_names.append(product.name)
            continue

        unit_price = variant.price if variant else product.base_price
        oos = False

        stock_obj = variant if variant else product
        if stock_obj.stock_quantity >= item.quantity:
            stock_obj.stock_quantity -= item.quantity
            stock_obj.save(update_fields=["stock_quantity"])
        else:
            oos = True
            has_oos = True

        OrderItem.objects.create(
            order=order,
            product=product,
            variant=variant,
            product_name=product.name,
            variant_name=variant.name if variant else "",
            unit_price=unit_price,
            quantity=item.quantity,
            was_out_of_stock=oos,
        )

    # If every item was excluded/inactive, abort and rollback
    if not order.items.exists():
        raise ValueError(
            "All items in your cart are currently unavailable. "
            "Please remove them and add available products."
        )

    order.has_out_of_stock_items = has_oos
    order.calculate_totals()

    note = "Order created"
    if excluded_names:
        note += f" ({len(excluded_names)} unavailable item(s) excluded: {', '.join(excluded_names)})"

    OrderStatusHistory.objects.create(
        order=order,
        from_status="",
        to_status="pending",
        note=note,
    )

    if has_oos:
        from apps.notifications.tasks import notify_admin_out_of_stock
        notify_admin_out_of_stock.delay(str(order.id))

    return order


def update_order_status(order: Order, new_status: str, changed_by, note: str = "") -> Order:
    """Update order status and record history."""
    old_status = order.status
    order.status = new_status

    if new_status == "delivered":
        order.delivered_at = timezone.now()
    elif new_status == "cancelled":
        order.cancelled_at = timezone.now()

    order.save(update_fields=["status", "delivered_at", "cancelled_at"])

    OrderStatusHistory.objects.create(
        order=order,
        from_status=old_status,
        to_status=new_status,
        changed_by=changed_by,
        note=note,
    )

    from apps.notifications.models import Notification
    from apps.notifications.order_status_copy import (
        order_status_notification_message,
        order_status_notification_title,
    )

    try:
        Notification.objects.create(
            user=order.user,
            title=order_status_notification_title(new_status),
            message=order_status_notification_message(order.order_number, new_status),
            notification_type="order_update",
            action_url=f"/orders/{order.order_number}",
            metadata={"order_number": order.order_number, "status": new_status},
        )
    except Exception:
        logger.exception(
            "update_order_status: failed to create in-app notification for order %s",
            order.order_number,
        )

    try:
        from apps.notifications.tasks import send_order_status_update_email

        send_order_status_update_email.delay(str(order.id), new_status)
    except Exception:
        logger.exception(
            "update_order_status: failed to queue status email for order %s",
            order.order_number,
        )

    return order
