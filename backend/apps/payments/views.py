"""Payment views – Stripe integration."""
import stripe
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import ADMIN_API_PERMISSION_CLASSES
from apps.orders.models import Order

from .models import Payment
from .serializers import PaymentSerializer
from .services import create_payment_intent, handle_payment_failure, handle_payment_success, refund_payment


class CreatePaymentIntentView(APIView):
    """POST /api/v1/payments/create-intent/ – create Stripe PaymentIntent."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        order_number = request.data.get("order_number")
        if not order_number:
            return Response({"success": False, "message": "order_number is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order = Order.objects.get(order_number=order_number, user=request.user)
        except Order.DoesNotExist:
            return Response({"success": False, "message": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        if order.payment_status == "paid":
            return Response({"success": False, "message": "Order is already paid."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = create_payment_intent(order)
            return Response({"success": True, "data": result})
        except stripe.error.StripeError as e:
            return Response({"success": False, "message": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class PaymentWebhookView(APIView):
    """POST /api/v1/payments/webhook/ – Stripe webhook handler."""
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        payload = request.body
        sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")

        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
            )
        except (ValueError, stripe.error.SignatureVerificationError):
            return Response(status=status.HTTP_400_BAD_REQUEST)

        event_type = event["type"]
        payment_intent = event["data"]["object"]
        pi_id = payment_intent.get("id")

        if event_type == "payment_intent.succeeded":
            handle_payment_success(pi_id)
        elif event_type in ("payment_intent.payment_failed", "payment_intent.canceled"):
            failure_msg = payment_intent.get("last_payment_error", {}).get("message", "")
            handle_payment_failure(pi_id, failure_msg)

        return Response({"received": True})


class PaymentListView(APIView):
    """GET /api/v1/payments/ – user's payment history."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        payments = Payment.objects.filter(user=request.user).order_by("-created_at")
        serializer = PaymentSerializer(payments, many=True)
        return Response({"success": True, "data": serializer.data})


class RefundView(APIView):
    """POST /api/v1/payments/refund/ – admin-initiated refund."""
    permission_classes = ADMIN_API_PERMISSION_CLASSES

    def post(self, request):
        order_number = request.data.get("order_number")
        reason = request.data.get("reason", "")
        try:
            order = Order.objects.get(order_number=order_number)
            result = refund_payment(order, reason)
            return Response({"success": True, "data": result})
        except (Order.DoesNotExist, ValueError) as e:
            return Response({"success": False, "message": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except stripe.error.StripeError as e:
            return Response({"success": False, "message": str(e)}, status=status.HTTP_400_BAD_REQUEST)
