"""Stripe payment service."""
import stripe
from decimal import ROUND_HALF_UP, Decimal
from django.conf import settings
from django.db import transaction

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
        old_status = order.status
        order.payment_status = "paid"
        order.status = "confirmed"
        order.save(update_fields=["payment_status", "status"])

        from apps.orders.models import OrderStatusHistory

        OrderStatusHistory.objects.create(
            order=order,
            from_status=old_status,
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


def refund_payment(
    order: Order,
    reason: str = "",
    amount: int | None = None,
    item_ids: list | None = None,
) -> dict:
    """Initiate a Stripe refund — full, partial by amount, or partial by item selection.

    Args:
        order:    The order to refund.
        reason:   Human-readable reason stored in metadata / history.
        amount:   Explicit cents to refund.  Calculated from item_ids when provided.
                  ``None`` with no item_ids = full refund.
        item_ids: List of OrderItem UUIDs to refund (all their quantities).
                  When supplied, the refund amount is computed from those items
                  and each item's refunded_quantity is updated.
    """
    from apps.orders.models import OrderItem, OrderStatusHistory

    # Quick pre-flight — no locks, these facts don't change concurrently.
    if order.status == "pending":
        raise ValueError("Cannot refund an order whose payment has not been confirmed yet.")
    if order.status == "refunded":
        raise ValueError("This order has already been fully refunded.")

    payment = order.payments.filter(status="succeeded").order_by("-created_at").first()
    if not payment:
        raise ValueError("No successful payment found for this order.")
    if not payment.stripe_payment_intent_id:
        raise ValueError("No Stripe PaymentIntent ID associated with this payment.")

    # Validate item_ids structure before acquiring the lock.
    if item_ids and not OrderItem.objects.filter(id__in=item_ids, order=order).exists():
        raise ValueError("None of the specified item IDs belong to this order.")

    with transaction.atomic():
        # ── Lock order to serialise concurrent refund requests ────────────
        order = Order.objects.select_for_update().get(pk=order.pk)

        if order.status == "refunded":
            raise ValueError("This order has already been fully refunded.")

        # ── Resolve items and compute amount under the lock ───────────────
        items_to_refund: list[OrderItem] = []
        if item_ids:
            items_to_refund = list(
                OrderItem.objects.select_for_update().filter(id__in=item_ids, order=order)
            )
            already_fully_refunded = [i for i in items_to_refund if i.refunded_quantity >= i.quantity]
            if already_fully_refunded:
                names = ", ".join(i.product_name for i in already_fully_refunded)
                raise ValueError(f"Already fully refunded: {names}")
            amount = _money_to_cents(
                sum((i.quantity - i.refunded_quantity) * i.unit_price for i in items_to_refund)
            )

        max_refundable = _money_to_cents(payment.amount) - _money_to_cents(order.refunded_amount)
        if max_refundable <= 0:
            raise ValueError("This order has already been fully refunded.")

        refund_cents = amount if amount is not None else _money_to_cents(payment.amount)
        if refund_cents > max_refundable:
            raise ValueError(
                f"Refund amount (${refund_cents / 100:.2f}) exceeds the remaining "
                f"refundable balance (${max_refundable / 100:.2f})."
            )

        is_full_refund = refund_cents >= max_refundable

        # ── Call Stripe inside the transaction to hold the row lock ───────
        # Calling Stripe while holding a DB row lock serialises concurrent
        # admin refund requests for the same order.  The trade-off is that
        # the DB connection is held for the duration of the Stripe HTTP call
        # (~1-2 s typical).  Acceptable for this low-frequency admin endpoint;
        # a high-traffic app would use a distributed lock (Redis) instead.
        refund = stripe.Refund.create(
            payment_intent=payment.stripe_payment_intent_id,
            amount=refund_cents,
            reason="requested_by_customer",
            metadata={"order_number": order.order_number, "reason": reason},
        )

        refund_decimal = Decimal(refund_cents) / Decimal("100")

        # ── Update item-level tracking ────────────────────────────────────
        if not items_to_refund and is_full_refund:
            items_to_refund = list(OrderItem.objects.select_for_update().filter(order=order))

        item_notes = []
        for item in items_to_refund:
            qty = item.quantity - item.refunded_quantity
            if qty <= 0:
                continue
            item.refunded_quantity = item.quantity
            item.save(update_fields=["refunded_quantity"])
            item_notes.append(f"{item.product_name} ×{qty}")

        # ── Update payment record ─────────────────────────────────────────
        payment.status = "refunded" if is_full_refund else "partially_refunded"
        payment.stripe_refund_id = refund.id
        payment.refund_reason = reason
        payment.save(update_fields=["status", "stripe_refund_id", "refund_reason"])

        # ── Update order ──────────────────────────────────────────────────
        order.refunded_amount += refund_decimal
        old_status = order.status
        if is_full_refund:
            order.payment_status = "refunded"
            order.status = "refunded"
        else:
            order.payment_status = "partially_refunded"
        order.save(update_fields=["refunded_amount", "payment_status", "status"])

        # ── Status history ────────────────────────────────────────────────
        item_detail = f" Items: {', '.join(item_notes)}." if item_notes else ""
        history_note = (
            f"{'Full' if is_full_refund else 'Partial'} refund ${refund_decimal:.2f} AUD "
            f"via Stripe (ID: {refund.id}).{item_detail}"
            + (f" Reason: {reason}" if reason else "")
        )
        OrderStatusHistory.objects.create(
            order=order,
            from_status=old_status,
            to_status=order.status,
            note=history_note,
        )

    return {
        "refund_id": refund.id,
        "status": refund.status,
        "amount_cents": refund.amount,
        "amount_aud": float(refund_decimal),
        "currency": refund.currency,
        "is_full_refund": is_full_refund,
        "items_refunded": item_notes,
    }
