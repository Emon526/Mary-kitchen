"""Celery tasks for sending notifications."""
import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMessage
from django.core.mail import send_mail

from apps.notifications.order_status_copy import order_status_body_fragment
from apps.notifications.order_slip_pdf import build_order_slip_pdf

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3)
def send_otp_email(self, email: str, code: str, purpose: str):
    """Send OTP code to email."""
    purpose_labels = {
        "email_verify": "Email Verification",
        "password_reset": "Password Reset",
        "otp_login": "Login",
        "phone_verify": "Phone Verification",
    }
    label = purpose_labels.get(purpose, "Verification")
    try:
        message = (
            f"Your Mary Kitchen {label.lower()} code is: {code}\n\n"
            f"This code expires in {settings.OTP_EXPIRY_MINUTES} minutes.\n\n"
            "If you did not request this code, you can safely ignore this email.\n\n"
            "Do not share this code with anyone."
        )
        send_mail(
            subject=f"Mary Kitchen – Your {label} Code",
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=False,
        )
    except Exception as exc:
        raise self.retry(exc=exc, countdown=60)


@shared_task(bind=True, max_retries=3)
def send_order_confirmation_email(self, order_id: str):
    """Send order confirmation email with PDF slip to customer."""
    try:
        from apps.orders.models import Order
        from apps.notifications.models import Notification

        order = Order.objects.select_related("user").prefetch_related("items").get(id=order_id)
        user = order.user

        Notification.objects.get_or_create(
            user=user,
            notification_type="order_update",
            action_url=f"/orders/{order.order_number}",
            defaults=dict(
                title="Order placed successfully",
                message=f"Your order #{order.order_number} was placed and payment received.",
                metadata={"order_number": order.order_number},
            ),
        )

        message = (
            f"Hi {user.first_name},\n\n"
            f"Your order #{order.order_number} has been confirmed and is being processed.\n\n"
            f"Order Total: ${order.total_amount}\n"
            f"Order Type: {order.get_order_type_display()}\n\n"
            "Your order slip is attached as a PDF.\n\n"
            f"You can track your order at: {settings.FRONTEND_URL}/orders/{order.order_number}\n\n"
            "Thank you for shopping with Mary Kitchen!\n"
        )
        email = EmailMessage(
            subject=f"Mary Kitchen – Order #{order.order_number} Confirmed!",
            body=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[user.email],
        )
        email.attach(
            filename=f"order-{order.order_number}.pdf",
            content=build_order_slip_pdf(order),
            mimetype="application/pdf",
        )
        email.send(fail_silently=False)
    except Exception as exc:
        raise self.retry(exc=exc, countdown=60)


@shared_task
def send_order_status_update_email(order_id: str, new_status: str):
    """Send email for order status change (in-app notification is created in update_order_status).

    Best-effort only: must not raise into the request path when CELERY_TASK_ALWAYS_EAGER /
    CELERY_TASK_EAGER_PROPAGATES is enabled (would return 500 after the order row is already saved).
    """
    try:
        from apps.orders.models import Order

        order = Order.objects.select_related("user").get(id=order_id)
        user = order.user
        msg = order_status_body_fragment(new_status)

        send_mail(
            subject=f"Mary Kitchen – Order #{order.order_number} Update",
            message=(
                f"Hi {user.first_name},\n\n"
                f"Your order #{order.order_number} {msg}.\n\n"
                f"Track your order: {settings.FRONTEND_URL}/orders/{order.order_number}\n\n"
                f"Thank you,\nMary Kitchen Team\n"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception:
        logger.exception(
            "send_order_status_update_email failed order_id=%s new_status=%s",
            order_id,
            new_status,
        )


@shared_task(bind=True, max_retries=3)
def notify_admin_out_of_stock(self, order_id: str):
    """Alert admin when an order contains out-of-stock items."""
    try:
        from apps.orders.models import Order
        from django.contrib.auth import get_user_model
        User = get_user_model()

        order = Order.objects.select_related("user").prefetch_related("items").get(id=order_id)
        oos_items = order.items.filter(was_out_of_stock=True)

        items_text = "\n".join([f"  - {item.product_name} × {item.quantity}" for item in oos_items])

        admin_emails = list(User.objects.filter(is_staff=True).values_list("email", flat=True))
        if not admin_emails:
            return

        send_mail(
            subject=f"⚠️ Out-of-Stock Order Alert – #{order.order_number}",
            message=(
                f"Order #{order.order_number} by {order.user.email} contains out-of-stock items:\n\n"
                f"{items_text}\n\n"
                f"Please review the order in the admin panel.\n"
                f"Order total: ${order.total_amount}\n"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=admin_emails,
            fail_silently=False,
        )

        order.admin_notified_out_of_stock = True
        order.save(update_fields=["admin_notified_out_of_stock"])
    except Exception as exc:
        raise self.retry(exc=exc, countdown=60)


@shared_task
def send_sms_placeholder(phone_number: str, message: str):
    """
    SMS sending placeholder.
    Replace with actual Twilio implementation when credentials are set.
    """
    from django.conf import settings
    if not all([settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_FROM_NUMBER]):
        print(f"[SMS PLACEHOLDER] To: {phone_number} | Message: {message}")
        return

    try:
        from twilio.rest import Client
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        client.messages.create(
            body=message,
            from_=settings.TWILIO_FROM_NUMBER,
            to=phone_number,
        )
    except Exception as e:
        print(f"[SMS ERROR] {e}")
