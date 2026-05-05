"""Order views."""
import datetime
import logging
from decimal import Decimal

import stripe
from django.db import transaction
from django.db.models import Count, DecimalField, ExpressionWrapper, F, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import ADMIN_API_PERMISSION_CLASSES, IsOwnerOrAdmin

from apps.payments.services import create_checkout_session

from .models import Order, OrderItem
from .serializers import (
    AdminOrderSerializer,
    AdminOrderStatusUpdateSerializer,
    CheckoutSerializer,
    OrderSerializer,
)
from .services import (
    abandon_unpaid_pending_checkouts,
    create_order_from_cart,
    rollback_checkout_order,
    update_order_status,
)

logger = logging.getLogger(__name__)


class CheckoutView(APIView):
    """POST /api/v1/orders/checkout/ – create order from cart."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        try:
            with transaction.atomic():
                abandon_unpaid_pending_checkouts(request.user)
                order = create_order_from_cart(
                    user=request.user,
                    order_type=d["order_type"],
                    address_id=d.get("address_id"),
                    notes=d.get("notes", ""),
                    session_id=d.get("session_id", ""),
                )
                try:
                    payment = create_checkout_session(order)
                except stripe.error.StripeError:
                    rollback_checkout_order(order)
                    raise

            return Response(
                {
                    "success": True,
                    "message": "Order created. Redirect to Stripe to pay.",
                    "data": {
                        "order": OrderSerializer(order).data,
                        "payment": payment,
                    },
                },
                status=status.HTTP_201_CREATED,
            )
        except ValueError as e:
            return Response({"success": False, "message": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except stripe.error.StripeError as e:
            return Response({"success": False, "message": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class OrderListView(generics.ListAPIView):
    """GET /api/v1/orders/ – current user's order history."""
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Order.objects.filter(user=self.request.user)
            .prefetch_related("items", "status_history")
            .order_by("-created_at")
        )


class OrderDetailView(generics.RetrieveAPIView):
    """GET /api/v1/orders/<order_number>/"""
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "order_number"

    def get_queryset(self):
        return Order.objects.filter(user=self.request.user).prefetch_related("items", "status_history")


class CancelOrderView(APIView):
    """POST /api/v1/orders/<order_number>/cancel/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, order_number):
        try:
            order = Order.objects.get(order_number=order_number, user=request.user)
        except Order.DoesNotExist:
            return Response({"success": False, "message": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        if order.status not in ["pending", "confirmed"]:
            return Response(
                {"success": False, "message": "Order cannot be cancelled at this stage."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = request.data.get("reason", "")
        order.cancellation_reason = reason
        order = update_order_status(order, "cancelled", request.user, note=f"Cancelled by customer. {reason}")
        return Response({"success": True, "message": "Order cancelled.", "data": OrderSerializer(order).data})


# ─── Admin Views ──────────────────────────────────────────────────────────────

class AdminOrderListView(generics.ListAPIView):
    """Admin: list all orders with filters."""
    serializer_class = AdminOrderSerializer
    permission_classes = ADMIN_API_PERMISSION_CLASSES
    search_fields = ["order_number", "user__email"]
    filterset_fields = ["status", "order_type", "payment_status", "has_out_of_stock_items"]
    ordering_fields = ["created_at", "total_amount"]

    def get_queryset(self):
        return (
            Order.objects.all()
            .select_related("user")
            .prefetch_related("items", "status_history")
            .order_by("-created_at")
        )


class AdminOrderDetailView(generics.RetrieveUpdateAPIView):
    """Admin: view/edit an order."""
    serializer_class = AdminOrderSerializer
    permission_classes = ADMIN_API_PERMISSION_CLASSES
    queryset = Order.objects.all().prefetch_related("items", "status_history")
    lookup_field = "order_number"


class AdminRevenueView(APIView):
    """GET /api/v1/orders/admin/revenue/?days=7

    Returns daily revenue totals for paid orders over the last N days (max 90).
    Days with zero revenue are included so the chart always shows a full range.
    Response shape: [{ "name": "Mon", "revenue": 450.00 }, ...]
    """

    permission_classes = ADMIN_API_PERMISSION_CLASSES

    def get(self, request):
        try:
            days = max(1, min(int(request.query_params.get("days", 7)), 90))
        except (TypeError, ValueError):
            days = 7

        since = timezone.now().date() - datetime.timedelta(days=days - 1)

        rows = (
            Order.objects.filter(
                created_at__date__gte=since,
                payment_status="paid",
            )
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(revenue=Sum("total_amount"))
            .order_by("day")
        )

        revenue_by_date = {row["day"]: float(row["revenue"] or 0) for row in rows}

        result = []
        for i in range(days):
            d = since + datetime.timedelta(days=i)
            result.append({
                "name": d.strftime("%a"),
                "revenue": revenue_by_date.get(d, 0),
            })

        return Response(result)


class AdminDashboardStatsView(APIView):
    """GET /api/v1/orders/admin/stats/ – aggregate admin dashboard metrics."""

    permission_classes = ADMIN_API_PERMISSION_CLASSES

    def get(self, request):
        now = timezone.now()
        current_start = now - datetime.timedelta(days=7)
        previous_start = now - datetime.timedelta(days=14)

        current_orders = Order.objects.filter(created_at__gte=current_start)
        current_paid_orders = current_orders.filter(payment_status="paid")
        previous_paid_orders = Order.objects.filter(
            created_at__gte=previous_start,
            created_at__lt=current_start,
            payment_status="paid",
        )

        revenue_7d = float(current_paid_orders.aggregate(total=Sum("total_amount"))["total"] or 0)
        previous_revenue_7d = float(previous_paid_orders.aggregate(total=Sum("total_amount"))["total"] or 0)
        orders_count = current_orders.count()
        paid_orders_count = current_paid_orders.count()
        aov = revenue_7d / paid_orders_count if paid_orders_count else 0.0
        if previous_revenue_7d == 0:
            growth = 100.0 if revenue_7d > 0 else 0.0
        else:
            growth = ((revenue_7d - previous_revenue_7d) / previous_revenue_7d) * 100

        status_breakdown = list(
            current_orders.values("payment_status")
            .annotate(count=Count("id"))
            .order_by("payment_status")
        )

        return Response(
            {
                "revenue_7d": revenue_7d,
                "orders_count": orders_count,
                "aov": float(aov),
                "growth": float(growth),
                "status_breakdown": status_breakdown,
            }
        )


class AdminTopProductsView(APIView):
    """GET /api/v1/orders/admin/top-products/?days=7 – top products by paid revenue."""

    permission_classes = ADMIN_API_PERMISSION_CLASSES

    def get(self, request):
        try:
            days = max(1, min(int(request.query_params.get("days", 7)), 90))
        except (TypeError, ValueError):
            days = 7

        since = timezone.now().date() - datetime.timedelta(days=days - 1)
        line_revenue = ExpressionWrapper(
            F("quantity") * F("unit_price"),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        )

        rows = (
            OrderItem.objects.filter(
                order__created_at__date__gte=since,
                order__payment_status="paid",
            )
            .values("product_id", "product_name")
            .annotate(
                total_quantity=Sum("quantity"),
                total_revenue=Sum(line_revenue),
            )
            .order_by("-total_revenue")[:5]
        )

        return Response(
            [
                {
                    "product_id": row["product_id"],
                    "name": row["product_name"],
                    "total_quantity": row["total_quantity"] or 0,
                    "total_revenue": float(row["total_revenue"] or Decimal("0")),
                }
                for row in rows
            ]
        )


class AdminOrderStatusUpdateView(APIView):
    """POST /api/v1/orders/admin/<order_number>/status/"""
    permission_classes = ADMIN_API_PERMISSION_CLASSES

    def post(self, request, order_number):
        try:
            order = Order.objects.get(order_number=order_number)
        except Order.DoesNotExist:
            return Response({"success": False, "message": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = AdminOrderStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = update_order_status(
            order,
            new_status=serializer.validated_data["status"],
            changed_by=request.user,
            note=serializer.validated_data.get("note", ""),
        )
        try:
            data = AdminOrderSerializer(order).data
        except Exception:
            logger.exception(
                "Admin order status update: serializer failed for order_number=%s",
                order_number,
            )
            data = {"order_number": order.order_number, "status": order.status}
        return Response({"success": True, "data": data})
