"""Stripe payment service."""
import stripe
from decimal import ROUND_HALF_UP, Decimal
from django.conf import settings

from apps.cart.models import Cart
from apps.orders.models import Order
from .models import Payment

stripe.api_key = settings.STRIPE_SECRET_KEY


def _money_to_cents(amount: Decimal) -> int:
    return int((amount * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _checkout_line_items(order: Order) -> list:
    """Build Stripe Checkout line items; fall back to one line if discounts or rounding mismatch."""
    if order.discount_amount > 0:
        return [
            {
                "price_data": {
                    "currency": "aud",
                    "product_data": {
                        "name": f"Mary Kitchen — order #{order.order_number}",
                        "description": "Order total (includes discounts)",
                    },
                    "unit_amount": _money_to_cents(order.total_amount),
                },
                "quantity": 1,
            }
        ]

    lines = []
    for item in order.items.all():
        label = item.product_name
        if item.variant_name:
            label = f"{label} ({item.variant_name})"
        lines.append(
            {
                "price_data": {
                    "currency": "aud",
                    "product_data": {"name": label[:500]},
                    "unit_amount": _money_to_cents(item.unit_price),
                },
                "quantity": item.quantity,
            }
        )
    if order.delivery_fee and order.delivery_fee > 0:
        zone = order.delivery_zone_name or "Delivery"
        lines.append(
            {
                "price_data": {
                    "currency": "aud",
                    "product_data": {"name": f"Delivery — {zone}"[:500]},
                    "unit_amount": _money_to_cents(order.delivery_fee),
                },
                "quantity": 1,
            }
        )

    expected = _money_to_cents(order.total_amount)
    actual = sum(li["price_data"]["unit_amount"] * li["quantity"] for li in lines)
    if actual != expected:
        return [
            {
                "price_data": {
                    "currency": "aud",
                    "product_data": {"name": f"Mary Kitchen — order #{order.order_number}"},
                    "unit_amount": expected,
                },
                "quantity": 1,
            }
        ]
    return lines


def create_checkout_session(order: Order) -> dict:
    """Create a hosted Stripe Checkout Session for an order (full-page pay on stripe.com)."""
    base = settings.FRONTEND_URL.rstrip("/")
    success_url = f"{base}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{base}/checkout?canceled=1"

    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=_checkout_line_items(order),
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=order.order_number,
        customer_email=order.user.email or None,
        metadata={
            "order_id": str(order.id),
            "order_number": order.order_number,
        },
        payment_intent_data={
            "metadata": {
                "order_number": order.order_number,
                "order_id": str(order.id),
                "user_email": order.user.email or "",
            },
            "description": f"Mary Kitchen order #{order.order_number}",
        },
    )

    order.stripe_checkout_session_id = session.id
    order.save(update_fields=["stripe_checkout_session_id"])

    payment = Payment.objects.create(
        order=order,
        user=order.user,
        amount=order.total_amount,
        currency="AUD",
        status="pending",
        stripe_payment_intent_id="",
        stripe_client_secret="",
    )

    return {
        "checkout_url": session.url,
        "session_id": session.id,
        "payment_intent_id": "",
        "client_secret": "",
        "amount": order.total_amount,
        "currency": "AUD",
        "payment_id": str(payment.id),
    }


def handle_checkout_session_paid(session) -> Payment | None:
    """Attach Checkout's PaymentIntent to the local payment record, then mark paid."""
    pi_ref = session.get("payment_intent")
    pi_id = pi_ref if isinstance(pi_ref, str) else pi_ref.get("id") if pi_ref else ""
    if not pi_id:
        return None

    meta = session.get("metadata") or {}
    order_id = meta.get("order_id")
    session_id = session.get("id", "")

    try:
        if session_id:
            order = Order.objects.get(stripe_checkout_session_id=session_id)
        else:
            order = Order.objects.get(id=order_id)
    except Order.DoesNotExist:
        return None

    if order.stripe_payment_intent_id != pi_id:
        order.stripe_payment_intent_id = pi_id
        order.save(update_fields=["stripe_payment_intent_id"])

    payment = (
        Payment.objects.filter(stripe_payment_intent_id=pi_id, order=order)
        .order_by("-created_at")
        .first()
    )
    if payment is None:
        payment = (
            Payment.objects.filter(order=order)
            .exclude(status__in=["refunded"])
            .order_by("-created_at")
            .first()
        )

        if payment is None:
            payment = Payment.objects.create(
                order=order,
                user=order.user,
                amount=order.total_amount,
                currency="AUD",
                status="pending",
            )

        payment.stripe_payment_intent_id = pi_id
        payment.save(update_fields=["stripe_payment_intent_id"])

    return handle_payment_success(pi_id)


def create_payment_intent(order: Order) -> dict:
    """Create a Stripe PaymentIntent for an order (embedded Elements / legacy API)."""
    amount_cents = _money_to_cents(order.total_amount)

    intent = stripe.PaymentIntent.create(
        amount=amount_cents,
        currency="aud",
        automatic_payment_methods={"enabled": True},
        metadata={
            "order_number": order.order_number,
            "order_id": str(order.id),
            "user_email": order.user.email,
        },
        description=f"Mary Kitchen order #{order.order_number}",
    )

    payment = Payment.objects.create(
        order=order,
        user=order.user,
        amount=order.total_amount,
        currency="AUD",
        status="pending",
        stripe_payment_intent_id=intent.id,
        stripe_client_secret=intent.client_secret,
    )

    order.stripe_payment_intent_id = intent.id
    order.save(update_fields=["stripe_payment_intent_id"])

    return {
        "payment_intent_id": intent.id,
        "client_secret": intent.client_secret,
        "amount": order.total_amount,
        "currency": "AUD",
        "payment_id": str(payment.id),
    }


def handle_payment_success(payment_intent_id: str) -> Payment | None:
    """Mark payment and order as paid. Idempotent for duplicate webhooks."""
    payments = list(
        Payment.objects.select_related("order")
        .filter(stripe_payment_intent_id=payment_intent_id)
        .order_by("-created_at")
    )
    if not payments:
        return None

    payment = next((p for p in payments if p.status == "succeeded"), payments[0])
    duplicates = [p for p in payments if p.id != payment.id and p.status != "refunded"]
    if duplicates:
        Payment.objects.filter(id__in=[p.id for p in duplicates]).update(status="succeeded")

    from apps.notifications.services import notify_staff_new_paid_order

    if payment.status == "succeeded":
        order = payment.order
        if order.payment_status == "paid":
            notify_staff_new_paid_order(order)
            _clear_user_cart(order)
        return payment

    payment.status = "succeeded"
    payment.save(update_fields=["status"])

    order = payment.order
    if order.payment_status != "paid":
        order.payment_status = "paid"
        order.status = "confirmed"
        order.save(update_fields=["payment_status", "status"])

        from apps.orders.models import OrderStatusHistory

        OrderStatusHistory.objects.create(
            order=order,
            from_status="pending",
            to_status="confirmed",
            note="Payment received via Stripe",
        )

        from apps.notifications.tasks import send_order_confirmation_email

        notify_staff_new_paid_order(order)
        try:
            send_order_confirmation_email.delay(str(order.id))
        except Exception:
            # Email/PDF failures must not make a paid checkout look failed.
            import logging

            logging.getLogger(__name__).exception(
                "handle_payment_success: confirmation email task failed for order %s",
                order.order_number,
            )

    _clear_user_cart(order)

    return payment


def _clear_user_cart(order: Order) -> None:
    try:
        cart = Cart.objects.get(user=order.user)
        cart.clear()
    except Cart.DoesNotExist:
        pass


def handle_payment_failure(payment_intent_id: str, failure_message: str = "") -> Payment | None:
    """Mark payment as failed."""
    try:
        payment = Payment.objects.get(stripe_payment_intent_id=payment_intent_id)
        payment.status = "failed"
        payment.failure_message = failure_message
        payment.save(update_fields=["status", "failure_message"])

        payment.order.payment_status = "failed"
        payment.order.save(update_fields=["payment_status"])
        return payment
    except Payment.DoesNotExist:
        return None


def refund_payment(order: Order, reason: str = "") -> dict:
    """Initiate a Stripe refund."""
    payment = order.payments.filter(status="succeeded").last()
    if not payment:
        raise ValueError("No successful payment found for this order.")

    refund = stripe.Refund.create(
        payment_intent=payment.stripe_payment_intent_id,
        reason="requested_by_customer",
        metadata={"order_number": order.order_number, "reason": reason},
    )

    payment.status = "refunded"
    payment.save(update_fields=["status"])

    order.payment_status = "refunded"
    order.save(update_fields=["payment_status"])

    return {"refund_id": refund.id, "status": refund.status}
