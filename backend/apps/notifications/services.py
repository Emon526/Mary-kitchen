"""Create notifications for staff and customers."""
from decimal import Decimal

from django.contrib.auth import get_user_model


def notify_staff_new_paid_order(order) -> None:
    """
    Notify every active staff user that a new paid order is ready to fulfil.
    Called synchronously when payment succeeds (webhook-safe idempotent block).
    """
    from .models import Notification

    User = get_user_model()
    staff_ids = list(User.objects.filter(is_staff=True, is_active=True).values_list("id", flat=True))
    if not staff_ids:
        return

    customer = order.user
    label = (customer.full_name or "").strip() or customer.email
    total = order.total_amount if isinstance(order.total_amount, Decimal) else Decimal(str(order.total_amount))
    title = "New paid order"
    message = f"Order #{order.order_number} from {label} — ${total:.2f}"
    action_url = f"/admin/orders?order={order.order_number}"

    notifications = []
    for uid in staff_ids:
        already_exists = Notification.objects.filter(
            user_id=uid,
            notification_type="admin_order",
            metadata__order_number=order.order_number,
        ).exists()
        if already_exists:
            continue

        notifications.append(
            Notification(
                user_id=uid,
                title=title,
                message=message,
                notification_type="admin_order",
                action_url=action_url,
                metadata={"order_number": order.order_number, "order_id": str(order.id)},
            )
        )

    if notifications:
        Notification.objects.bulk_create(notifications)
