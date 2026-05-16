"""Order views."""
import datetime
import logging
from decimal import Decimal

import stripe
from django.db import transaction
from django.db.models import Case, Count, DecimalField, ExpressionWrapper, F, Sum, When
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import ADMIN_API_PERMISSION_CLASSES, IsOwnerOrAdmin

from apps.payments.models import Payment as PaymentModel
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
        order.save(update_fields=["cancellation_reason"])
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

        # Use localdate() so TruncDate (which uses settings.TIME_ZONE) and
        # the loop iteration both operate in the same timezone.
        since = timezone.localdate() - datetime.timedelta(days=days - 1)

        net_amount = ExpressionWrapper(
            F("total_amount") - F("refunded_amount"),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        )
        rows = (
            Order.objects.filter(
                created_at__date__gte=since,
                status="delivered",
                payment_status__in=["paid", "partially_refunded"],
            )
            .annotate(day=TruncDate("created_at"), net=net_amount)
            .values("day")
            .annotate(revenue=Sum("net"))
            .order_by("day")
        )

        revenue_by_date = {row["day"]: float(row["revenue"] or 0) for row in rows}

        label_fmt = "%a" if days <= 7 else "%b %d"
        result = []
        for i in range(days):
            d = since + datetime.timedelta(days=i)
            result.append({
                "name": d.strftime(label_fmt),
                "revenue": revenue_by_date.get(d, 0),
            })

        return Response(result)


class AdminDashboardStatsView(APIView):
    """GET /api/v1/orders/admin/stats/?days=7 – aggregate admin dashboard metrics."""

    permission_classes = ADMIN_API_PERMISSION_CLASSES

    def get(self, request):
        try:
            days = max(1, min(int(request.query_params.get("days", 7)), 90))
        except (TypeError, ValueError):
            days = 7

        now = timezone.now()
        current_start = now - datetime.timedelta(days=days)
        previous_start = now - datetime.timedelta(days=days * 2)

        net_expr = ExpressionWrapper(
            F("total_amount") - F("refunded_amount"),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        )

        current_orders = Order.objects.filter(created_at__gte=current_start)
        current_revenue_qs = current_orders.filter(
            status="delivered",
            payment_status__in=["paid", "partially_refunded"],
        )
        previous_revenue_qs = Order.objects.filter(
            created_at__gte=previous_start,
            created_at__lt=current_start,
            status="delivered",
            payment_status__in=["paid", "partially_refunded"],
        )

        current_agg = current_revenue_qs.annotate(net=net_expr).aggregate(
            total=Sum("net"), count=Count("id")
        )
        revenue = float(current_agg["total"] or 0)
        paid_orders_count = current_agg["count"] or 0
        previous_revenue = float(
            previous_revenue_qs.annotate(net=net_expr).aggregate(total=Sum("net"))["total"] or 0
        )
        orders_count = current_orders.count()
        aov = revenue / paid_orders_count if paid_orders_count else 0.0
        if previous_revenue == 0:
            growth = 100.0 if revenue > 0 else 0.0
        else:
            growth = ((revenue - previous_revenue) / previous_revenue) * 100

        status_breakdown = list(
            current_orders.values("payment_status")
            .annotate(count=Count("id"))
            .order_by("payment_status")
        )

        return Response(
            {
                "revenue": revenue,
                "orders_count": orders_count,
                "aov": float(aov),
                "growth": float(growth),
                "status_breakdown": status_breakdown,
                "days": days,
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

        since = timezone.localdate() - datetime.timedelta(days=days - 1)
        line_revenue = ExpressionWrapper(
            F("quantity") * F("unit_price"),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        )

        rows = (
            OrderItem.objects.filter(
                order__created_at__date__gte=since,
                order__payment_status="paid",
                order__status="delivered",
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


class AdminRefundStatsView(APIView):
    """GET /api/v1/orders/admin/refund-stats/?days=7

    Returns:
      - total_refunds       – number of refunded orders in the period
      - total_refunded_amount – sum of order total_amount for those orders
      - top_refunded_products – top 5 products that appear in refunded orders
          (by refund count, then by refunded revenue)
    """

    permission_classes = ADMIN_API_PERMISSION_CLASSES

    def get(self, request):
        try:
            days = max(1, min(int(request.query_params.get("days", 7)), 90))
        except (TypeError, ValueError):
            days = 7

        since = timezone.now() - datetime.timedelta(days=days)

        # Scope to orders whose Payment record transitioned to refunded/partially_refunded
        # within the window. Using Payment.updated_at is accurate — it only changes when
        # the payment status changes, unlike Order.updated_at which updates on any field.
        refunded_order_ids = PaymentModel.objects.filter(
            status__in=["refunded", "partially_refunded"],
            updated_at__gte=since,
        ).values_list("order_id", flat=True)

        all_refund_orders = Order.objects.filter(
            id__in=refunded_order_ids,
            payment_status__in=["refunded", "partially_refunded"],
        )

        total_refunds = all_refund_orders.count()
        total_refunded_amount = float(
            all_refund_orders.aggregate(total=Sum("refunded_amount"))["total"] or 0
        )

        # Effective refunded qty: use full quantity for fully-refunded orders,
        # refunded_quantity for partially-refunded ones.
        effective_qty = Case(
            When(order__payment_status="refunded", then=F("quantity")),
            default=F("refunded_quantity"),
            output_field=DecimalField(max_digits=10, decimal_places=2),
        )
        effective_revenue = ExpressionWrapper(
            effective_qty * F("unit_price"),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        )
        top_refunded_products = list(
            OrderItem.objects.filter(order__in=all_refund_orders)
            .annotate(eff_qty=effective_qty)
            .filter(eff_qty__gt=0)
            .values("product_id", "product_name")
            .annotate(
                refund_count=Count("order_id", distinct=True),
                refunded_qty=Sum(effective_qty),
                refunded_amount=Sum(effective_revenue),
            )
            .order_by("-refund_count", "-refunded_amount")[:5]
        )

        return Response(
            {
                "days": days,
                "total_refunds": total_refunds,
                "total_refunded_amount": total_refunded_amount,
                "top_refunded_products": [
                    {
                        "product_id": row["product_id"],
                        "name": row["product_name"],
                        "refund_count": row["refund_count"] or 0,
                        "refunded_quantity": row["refunded_qty"] or 0,
                        "refunded_amount": float(row["refunded_amount"] or Decimal("0")),
                    }
                    for row in top_refunded_products
                ],
            }
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
        try:
            order = update_order_status(
                order,
                new_status=serializer.validated_data["status"],
                changed_by=request.user,
                note=serializer.validated_data.get("note", ""),
                force=serializer.validated_data.get("force", False),
            )
        except ValueError as e:
            return Response({"success": False, "message": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        try:
            data = AdminOrderSerializer(order).data
        except Exception:
            logger.exception(
                "Admin order status update: serializer failed for order_number=%s",
                order_number,
            )
            data = {"order_number": order.order_number, "status": order.status}
        return Response({"success": True, "data": data})
